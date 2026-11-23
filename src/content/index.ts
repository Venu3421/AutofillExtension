import { AppState, DEFAULT_APP_STATE, CustomFieldMapping, Profile, ExtensionSettings } from '../models/schema';
import { scanForm, DetectedFormState } from './field-detector';
import { executeTier1Autofill, AuditReport } from './fill-engine';
import { FloatingPanel } from './floating-panel';

let appState: AppState = DEFAULT_APP_STATE;
let activeProfile: Profile | null = null;
let currentFormState: DetectedFormState | null = null;
let floatingPanel: FloatingPanel | null = null;
let mutationObserver: MutationObserver | null = null;

/**
 * Initializes content script on TTD page.
 */
async function initContentScript(): Promise<void> {
  // Load state from chrome.storage.local
  await loadState();

  if (!activeProfile) {
    activeProfile = appState.profiles[0] || null;
  }

  // Initial Scan
  rescanDOM();

  // Create & Mount Floating Panel (always mount so user has IST clock & status)
  if (!floatingPanel && activeProfile) {
    floatingPanel = new FloatingPanel(
      (mode) => handleFillRequest(mode),
      (profileId) => handleProfileChange(profileId),
      (mapping) => handleSaveMapping(mapping),
      () => handleExportMappings(),
      () => { rescanDOM(); return currentFormState!; },
      () => handleClearMappings()
    );
    floatingPanel.mount(activeProfile, appState.settings, currentFormState || { pilgrimRowsCount: 0, elements: [] });
  }

  // Setup MutationObserver to rescan on dynamic Angular/SPA changes
  setupMutationObserver();
  setupSpaRouteListeners();

  // Listen for mock portal tab switch event
  document.addEventListener('ttd-tab-switched', () => {
    rescanDOM();
  });

  // Listen for messages from background (e.g. keyboard shortcuts Alt+A, Alt+S)
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'EXECUTE_FILL') {
      handleFillRequest(message.mode || 'auto');
      sendResponse({ status: 'started' });
      return true;
    }
    return false;
  });

  // Listen for storage changes from popup
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['app_state']) {
      loadState().then(() => {
        rescanDOM();
        if (floatingPanel && activeProfile && currentFormState) {
          floatingPanel.update(activeProfile, appState.settings, currentFormState);
        }
      });
    }
  });

  // Periodic rescan every 1.5s to immediately catch Angular dynamic form components
  setInterval(() => {
    rescanDOM();
  }, 1500);
}

/**
 * Loads current AppState and resolves active profile.
 */
async function loadState(): Promise<void> {
  try {
    const res = await chrome.storage.local.get('app_state');
    if (res['app_state']) {
      appState = res['app_state'] as AppState;
    }
  } catch (e) {
    console.warn('[Pilgrim QuickFill] Failed loading storage:', e);
  }

  // Auto-clean any conflicting/accidental custom mappings on official TTD domain
  if (appState.settings.customFieldMappings && appState.settings.customFieldMappings.length > 0) {
    const initialLen = appState.settings.customFieldMappings.length;
    appState.settings.customFieldMappings = appState.settings.customFieldMappings.filter(m => {
      // Discard mappings that captured background container DIVs or whole sections
      if (m.selector.includes('div#__next') && !m.selector.endsWith('input') && !m.selector.endsWith('select')) return false;
      // Discard mappings that mapped Gothram to fullName
      if (m.fieldKey.includes('fullName') && (m.selector.includes('Gothram') || m.meta?.name === 'pilgrimGothram')) return false;
      // Discard multiple mappings mapping to pilgrim_0_fullName on the live domain
      if (m.domainPath?.includes('ttdevasthanams.ap.gov.in') && m.fieldKey === 'pilgrim_0_fullName') return false;
      return true;
    });

    if (appState.settings.customFieldMappings.length !== initialLen) {
      console.log('[Pilgrim QuickFill] Auto-cleaned corrupted test mappings.');
      try {
        await chrome.storage.local.set({ app_state: appState });
      } catch (e) {}
    }
  }

  // Resolve active profile
  activeProfile = appState.profiles.find(p => p.id === appState.activeProfileId) || appState.profiles[0] || null;
}

/**
 * Scans DOM using field detector.
 */
function rescanDOM(): void {
  if (!activeProfile) return;

  const mappings = appState.settings.customFieldMappings || [];
  currentFormState = scanForm(activeProfile.pilgrims, activeProfile.general, mappings);

  if (floatingPanel && activeProfile) {
    floatingPanel.update(activeProfile, appState.settings, currentFormState);
  }
}

/**
 * Executes Tier 1 autofill and triggers audit update.
 */
async function handleFillRequest(mode: 'auto' | 'auto_continue'): Promise<void> {
  if (!activeProfile) return;

  // Fresh rescan before filling to catch any newly rendered fields
  rescanDOM();
  if (!currentFormState || currentFormState.elements.length === 0) {
    alert('No visible booking fields detected yet on this page. Navigate to the pilgrim details form first.');
    return;
  }

  const fillAndContinue = mode === 'auto_continue' || appState.settings.fillAndContinueEnabled;

  const audit = await executeTier1Autofill(currentFormState, {
    fillAndContinue,
    autoFocusCaptcha: appState.settings.autoFocusCaptcha
  });

  floatingPanel?.updateAudit(audit);
}

/**
 * Switches active profile from on-page panel.
 */
async function handleProfileChange(profileId: string): Promise<void> {
  appState.activeProfileId = profileId;
  activeProfile = appState.profiles.find(p => p.id === profileId) || null;
  await chrome.storage.local.set({ app_state: appState });
  rescanDOM();
}

/**
 * Saves a new custom field mapping to storage.
 */
async function handleSaveMapping(mapping: CustomFieldMapping): Promise<void> {
  if (!appState.settings.customFieldMappings) {
    appState.settings.customFieldMappings = [];
  }
  appState.settings.customFieldMappings.push(mapping);
  await chrome.storage.local.set({ app_state: appState });
  rescanDOM();
}

/**
 * Exports custom selector mappings as a clean, PII-free JSON file.
 */
function handleExportMappings(): void {
  const mappings = appState.settings.customFieldMappings || [];
  if (mappings.length === 0) {
    alert('No custom field mappings saved yet. Use "Map Field" on TTD first.');
    return;
  }

  const exportData = {
    exportedAt: new Date().toISOString(),
    version: '1.0.0',
    domain: window.location.hostname,
    mappings: mappings.map(m => ({
      fieldKey: m.fieldKey,
      domainPath: m.domainPath,
      selector: m.selector,
      meta: m.meta
    }))
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ttd-field-mappings-${window.location.hostname}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Clears custom field mappings and switches back to pure automatic detection.
 */
function handleClearMappings(): void {
  if (confirm('Clear all custom field mappings? Pilgrim QuickFill will use automatic field detection.')) {
    appState.settings.customFieldMappings = [];
    chrome.storage.local.set({ app_state: appState }).then(() => {
      rescanDOM();
      alert('✅ Custom mappings cleared. Automatic field detection active.');
    });
  }
}

/**
 * Watches DOM mutations and debounces rescans.
 */
function setupMutationObserver(): void {
  let timeout: number | null = null;
  mutationObserver = new MutationObserver((mutations) => {
    // Ignore mutations inside our own floating panel
    const hasExternalMutations = mutations.some(m => {
      const target = m.target as HTMLElement;
      return !target.closest?.('pilgrim-quickfill-root') && !target.closest?.('#pilgrim-quickfill-extension-host');
    });

    if (!hasExternalMutations) return;

    if (timeout) clearTimeout(timeout);
    timeout = window.setTimeout(() => {
      rescanDOM();
    }, 250);
  });

  const targetRoot = document.body || document.documentElement;
  if (targetRoot) {
    mutationObserver.observe(targetRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'disabled', 'hidden']
    });
  }
}

/**
 * Listens for Angular SPA navigation (pushState, replaceState, popstate, hashchange).
 */
function setupSpaRouteListeners(): void {
  const onRouteChanged = () => {
    setTimeout(() => rescanDOM(), 250);
  };

  window.addEventListener('popstate', onRouteChanged);
  window.addEventListener('hashchange', onRouteChanged);

  // Monkey patch pushState and replaceState for Angular Router
  try {
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      onRouteChanged();
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      onRouteChanged();
    };
  } catch (e) {
    console.warn('[Pilgrim QuickFill] Could not monkey-patch history:', e);
  }
}

// Run initialization
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContentScript);
} else {
  initContentScript();
}
