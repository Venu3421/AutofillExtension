import {
  AppState,
  Profile,
  Pilgrim,
  DEFAULT_APP_STATE,
  createDefaultPilgrim,
  createDefaultProfile,
  BookingPreset,
  StoredDoc
} from '../models/schema';
import {
  evaluateBookingReadiness,
  validateAadhaar,
  formatAadhaarChunks,
  validateProofDocument,
  checkSpecialDarshanCooldown,
  MAX_DOC_SIZE_BYTES
} from '../validation/validators';
import { encryptVault, decryptVault } from '../crypto/vault';

/**
 * Automatically compresses an image file using client-side canvas so it's under 900 KB.
 */
export async function compressImage(file: File): Promise<StoredDoc> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        const maxDim = 1600;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas context unavailable'));
        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.85;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        let base64 = dataUrl.split(',')[1];
        let bytes = Math.round((base64.length * 3) / 4);

        while (bytes > 900 * 1024 && quality > 0.3) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          base64 = dataUrl.split(',')[1];
          bytes = Math.round((base64.length * 3) / 4);
        }

        resolve({
          fileName: file.name.replace(/\.[^/.]+$/, '') + '-compressed.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: bytes,
          base64Data: base64
        });
      };
      img.onerror = () => reject(new Error('Failed loading image for compression'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed reading file'));
    reader.readAsDataURL(file);
  });
}

let appState: AppState = DEFAULT_APP_STATE;
let activeProfile: Profile | null = null;
let saveDebounceTimer: number | null = null;

// DOM Elements
const consentModal = document.getElementById('consent-modal') as HTMLElement;
const btnAcceptConsent = document.getElementById('btn-accept-consent') as HTMLButtonElement;
const readinessBanner = document.getElementById('readiness-banner') as HTMLElement;
const readinessTitle = document.getElementById('readiness-title') as HTMLElement;
const readinessErrors = document.getElementById('readiness-errors') as HTMLElement;
const selectProfile = document.getElementById('select-profile') as HTMLSelectElement;
const btnAddProfile = document.getElementById('btn-add-profile') as HTMLButtonElement;
const btnDeleteProfile = document.getElementById('btn-delete-profile') as HTMLButtonElement;
const selectPreset = document.getElementById('select-preset') as HTMLSelectElement;
const pilgrimsContainer = document.getElementById('pilgrims-container') as HTMLElement;
const btnAddPilgrim = document.getElementById('btn-add-pilgrim') as HTMLButtonElement;
const pilgrimCountBadge = document.getElementById('pilgrim-count-badge') as HTMLElement;
const clockIst = document.getElementById('clock-ist') as HTMLElement;
const btnThemeToggle = document.getElementById('btn-theme-toggle') as HTMLButtonElement;

// General Inputs
const inputEmail = document.getElementById('input-email') as HTMLInputElement;
const inputGeneralGothram = document.getElementById('input-general-gothram') as HTMLInputElement;
const inputMobile = document.getElementById('input-mobile') as HTMLInputElement;
const inputCountry = document.getElementById('input-country') as HTMLInputElement;
const inputState = document.getElementById('input-state') as HTMLInputElement;
const inputCity = document.getElementById('input-city') as HTMLInputElement;
const inputPincode = document.getElementById('input-pincode') as HTMLInputElement;

// Volunteer Inputs
const inputProfession = document.getElementById('input-profession') as HTMLInputElement;
const inputEducation = document.getElementById('input-education') as HTMLInputElement;
const inputLanguages = document.getElementById('input-languages') as HTMLInputElement;
const inputVolunteerExp = document.getElementById('input-volunteer-exp') as HTMLInputElement;
const inputLocation = document.getElementById('input-location') as HTMLInputElement;
const inputFrequency = document.getElementById('input-frequency') as HTMLInputElement;

// Settings Inputs
const checkFillContinue = document.getElementById('check-fill-continue') as HTMLInputElement;
const checkFocusCaptcha = document.getElementById('check-focus-captcha') as HTMLInputElement;
const inputTargetTime = document.getElementById('input-target-time') as HTMLInputElement;
const btnExportSelectors = document.getElementById('btn-export-selectors-settings') as HTMLButtonElement;
const btnExportBackup = document.getElementById('btn-export-backup') as HTMLButtonElement;
const btnImportBackup = document.getElementById('btn-import-backup') as HTMLButtonElement;
const fileImportBackup = document.getElementById('file-import-backup') as HTMLInputElement;
const btnWipeData = document.getElementById('btn-wipe-data') as HTMLButtonElement;

/**
 * Initialize Popup
 */
async function init(): Promise<void> {
  await loadState();
  applyTheme();
  setupTabs();
  startClock();
  setupEventListeners();

  // Check PII Consent
  if (!appState.settings.piiConsentAccepted) {
    consentModal.classList.remove('hidden');
  }

  renderProfileSelector();
  renderActiveProfile();
  updateReadiness();
}

/**
 * Loads state from chrome.storage.local
 */
async function loadState(): Promise<void> {
  try {
    const res = await chrome.storage.local.get('app_state');
    if (res['app_state']) {
      appState = res['app_state'] as AppState;
      // If user had previous empty pilgrims from early testing, populate with complete sample data
      if (appState.profiles && appState.profiles[0] && !appState.profiles[0].pilgrims[0]?.fullName) {
        appState.profiles[0] = createDefaultProfile('Family');
        await chrome.storage.local.set({ app_state: appState });
      }
      // Auto-clean any conflicting/accidental custom mappings on official TTD domain
      if (appState.settings.customFieldMappings && appState.settings.customFieldMappings.length > 0) {
        const initialLen = appState.settings.customFieldMappings.length;
        appState.settings.customFieldMappings = appState.settings.customFieldMappings.filter(m => {
          if (m.selector.includes('div#__next') && !m.selector.endsWith('input') && !m.selector.endsWith('select')) return false;
          if (m.fieldKey.includes('fullName') && (m.selector.includes('Gothram') || m.meta?.name === 'pilgrimGothram')) return false;
          if (m.domainPath?.includes('ttdevasthanams.ap.gov.in') && m.fieldKey === 'pilgrim_0_fullName') return false;
          return true;
        });
        if (appState.settings.customFieldMappings.length !== initialLen) {
          await chrome.storage.local.set({ app_state: appState });
        }
      }
    } else {
      appState = JSON.parse(JSON.stringify(DEFAULT_APP_STATE));
      await chrome.storage.local.set({ app_state: appState });
    }
  } catch (e) {
    console.error('Failed to load storage:', e);
    appState = JSON.parse(JSON.stringify(DEFAULT_APP_STATE));
  }

  activeProfile = appState.profiles.find(p => p.id === appState.activeProfileId) || appState.profiles[0];
  if (activeProfile && !activeProfile.attendantConfig) {
    activeProfile.attendantConfig = { requiresAttendant: false, companionRelationship: 'Spouse' };
  }
}

/**
 * Debounced auto-save to chrome.storage.local
 */
function scheduleAutoSave(): void {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = window.setTimeout(async () => {
    if (activeProfile) {
      activeProfile.updatedAt = Date.now();
    }
    await chrome.storage.local.set({ app_state: appState });
    updateReadiness();
  }, 300);
}

/**
 * Applies active theme
 */
function applyTheme(): void {
  const theme = appState.settings.theme;
  if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

/**
 * Live IST Clock
 */
function startClock(): void {
  const update = () => {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istTime = new Date(utc + (3600000 * 5.5));
    const h = String(istTime.getHours()).padStart(2, '0');
    const m = String(istTime.getMinutes()).padStart(2, '0');
    const s = String(istTime.getSeconds()).padStart(2, '0');
    clockIst.textContent = `${h}:${m}:${s} IST`;
  };
  update();
  setInterval(update, 1000);
}

/**
 * Tabs Switching
 */
function setupTabs(): void {
  const tabBtns = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      if (targetId) {
        document.getElementById(targetId)?.classList.add('active');
      }
      if (targetId === 'tab-quick-copy') {
        renderQuickCopyList();
      }
    });
  });
}

/**
 * Event Listeners
 */
function setupEventListeners(): void {
  // Consent Acceptance
  btnAcceptConsent.addEventListener('click', async () => {
    appState.settings.piiConsentAccepted = true;
    await chrome.storage.local.set({ app_state: appState });
    consentModal.classList.add('hidden');
  });

  // Theme Toggle
  btnThemeToggle.addEventListener('click', async () => {
    appState.settings.theme = appState.settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    await chrome.storage.local.set({ app_state: appState });
  });

  // Profile Selector
  selectProfile.addEventListener('change', () => {
    const targetId = selectProfile.value;
    appState.activeProfileId = targetId;
    activeProfile = appState.profiles.find(p => p.id === targetId) || null;
    chrome.storage.local.set({ app_state: appState });
    renderActiveProfile();
    updateReadiness();
  });

  // Add Profile
  btnAddProfile.addEventListener('click', async () => {
    const name = prompt('Enter profile name (e.g. Relatives, Parents):');
    if (!name || !name.trim()) return;
    const newProfile = createDefaultProfile(name.trim());
    appState.profiles.push(newProfile);
    appState.activeProfileId = newProfile.id;
    activeProfile = newProfile;
    await chrome.storage.local.set({ app_state: appState });
    renderProfileSelector();
    renderActiveProfile();
    updateReadiness();
  });

  // Delete Profile
  btnDeleteProfile.addEventListener('click', async () => {
    if (appState.profiles.length <= 1) {
      alert('You must keep at least one profile.');
      return;
    }
    if (!confirm(`Delete profile "${activeProfile?.name}"?`)) return;

    appState.profiles = appState.profiles.filter(p => p.id !== activeProfile?.id);
    appState.activeProfileId = appState.profiles[0].id;
    activeProfile = appState.profiles[0];
    await chrome.storage.local.set({ app_state: appState });
    renderProfileSelector();
    renderActiveProfile();
    updateReadiness();
  });

  // Preset Selector
  selectPreset.addEventListener('change', () => {
    if (!activeProfile) return;
    activeProfile.bookingPreset = selectPreset.value as BookingPreset;
    scheduleAutoSave();
  });

  // Add Pilgrim
  btnAddPilgrim.addEventListener('click', () => {
    if (!activeProfile) return;
    if (activeProfile.pilgrims.length >= 6) {
      alert('Maximum 6 pilgrims allowed per profile.');
      return;
    }
    activeProfile.pilgrims.push(createDefaultPilgrim(activeProfile.pilgrims.length + 1));
    renderPilgrims();
    scheduleAutoSave();
  });

  // General Inputs
  const generalInputs = [
    { el: inputEmail, key: 'email' },
    { el: inputGeneralGothram, key: 'gothram' },
    { el: inputMobile, key: 'mobile' },
    { el: inputCountry, key: 'country' },
    { el: inputState, key: 'state' },
    { el: inputCity, key: 'city' },
    { el: inputPincode, key: 'pincode' }
  ];
  generalInputs.forEach(({ el, key }) => {
    el.addEventListener('input', () => {
      if (!activeProfile) return;
      (activeProfile.general as any)[key] = el.value.trim();
      scheduleAutoSave();
    });
  });

  // Volunteer Inputs
  const volunteerInputs = [
    { el: inputProfession, key: 'profession' },
    { el: inputEducation, key: 'education' },
    { el: inputLanguages, key: 'languages' },
    { el: inputVolunteerExp, key: 'volunteerExperience' },
    { el: inputLocation, key: 'preferredLocation' },
    { el: inputFrequency, key: 'frequency' }
  ];
  volunteerInputs.forEach(({ el, key }) => {
    el.addEventListener('input', () => {
      if (!activeProfile) return;
      (activeProfile.volunteer as any)[key] = el.value.trim();
      scheduleAutoSave();
    });
  });

  // Settings
  checkFillContinue.addEventListener('change', () => {
    appState.settings.fillAndContinueEnabled = checkFillContinue.checked;
    scheduleAutoSave();
  });

  checkFocusCaptcha.addEventListener('change', () => {
    appState.settings.autoFocusCaptcha = checkFocusCaptcha.checked;
    scheduleAutoSave();
  });

  inputTargetTime.addEventListener('input', () => {
    appState.settings.targetReleaseTime = inputTargetTime.value.trim();
    scheduleAutoSave();
  });

  // Export Selectors
  btnExportSelectors.addEventListener('click', () => {
    const mappings = appState.settings.customFieldMappings || [];
    if (mappings.length === 0) {
      alert('No custom field mappings recorded yet.');
      return;
    }
    const exportData = {
      exportedAt: new Date().toISOString(),
      version: '1.0.0',
      mappings
    };
    downloadJson(exportData, `ttd-custom-selectors-${Date.now()}.json`);
  });

  // Clear / Reset Custom Mappings (Settings Tab)
  const btnClearMappingsSettings = document.getElementById('btn-clear-mappings-settings') as HTMLButtonElement;
  btnClearMappingsSettings?.addEventListener('click', async () => {
    if (confirm('Clear all custom field mappings? Pilgrim QuickFill will use automatic field detection on TTD forms.')) {
      appState.settings.customFieldMappings = [];
      await chrome.storage.local.set({ app_state: appState });
      alert('✅ All custom field mappings cleared! Automatic field detection is now active.');
    }
  });

  // Export Encrypted Backup
  btnExportBackup.addEventListener('click', async () => {
    const password = prompt('Enter a password to encrypt this backup:');
    if (!password) return;
    try {
      const plaintext = JSON.stringify(appState);
      const encrypted = await encryptVault(plaintext, password);
      downloadJson(encrypted, `pilgrim-quickfill-backup-${Date.now()}.json`);
    } catch (e) {
      alert('Failed to encrypt backup: ' + e);
    }
  });

  // Import Encrypted Backup
  btnImportBackup.addEventListener('click', () => {
    fileImportBackup.click();
  });

  fileImportBackup.addEventListener('change', async () => {
    const file = fileImportBackup.files?.[0];
    if (!file) return;

    const password = prompt('Enter the password for this encrypted backup:');
    if (!password) return;

    try {
      const text = await file.text();
      const vaultData = JSON.parse(text);
      const decrypted = await decryptVault(vaultData, password);
      const importedState = JSON.parse(decrypted) as AppState;

      if (!importedState.profiles || !Array.isArray(importedState.profiles)) {
        throw new Error('Invalid backup file structure.');
      }

      appState = importedState;
      await chrome.storage.local.set({ app_state: appState });
      activeProfile = appState.profiles.find(p => p.id === appState.activeProfileId) || appState.profiles[0];
  if (activeProfile && !activeProfile.attendantConfig) {
    activeProfile.attendantConfig = { requiresAttendant: false, companionRelationship: 'Spouse' };
  }
      renderProfileSelector();
      renderActiveProfile();
      updateReadiness();
      alert('✅ Backup restored successfully!');
    } catch (e) {
      alert('❌ Failed to restore backup: ' + e);
    } finally {
      fileImportBackup.value = '';
    }
  });

  // Wipe All Data
  btnWipeData.addEventListener('click', async () => {
    if (!confirm('⚠️ Are you sure you want to completely wipe all saved pilgrim profiles and settings from this device? This action cannot be undone.')) {
      return;
    }
    await chrome.storage.local.clear();
    appState = JSON.parse(JSON.stringify(DEFAULT_APP_STATE));
    await chrome.storage.local.set({ app_state: appState });
    activeProfile = appState.profiles[0];
    renderProfileSelector();
    renderActiveProfile();
    updateReadiness();
    alert('All local data wiped clean.');
  });
}

/**
 * Downloads JSON file
 */
function downloadJson(data: any, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Renders Profile Selector dropdown
 */
function renderProfileSelector(): void {
  selectProfile.innerHTML = '';
  appState.profiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.pilgrims.filter(pl => pl.included).length} included)`;
    if (p.id === appState.activeProfileId) opt.selected = true;
    selectProfile.appendChild(opt);
  });
}

/**
 * Renders Active Profile Data
 */
function renderActiveProfile(): void {
  if (!activeProfile) return;

  selectPreset.value = activeProfile.bookingPreset || 'sed300';

  // Contact
  inputEmail.value = activeProfile.general.email || '';
  if (inputGeneralGothram) inputGeneralGothram.value = activeProfile.general.gothram || activeProfile.pilgrims[0]?.gothram || 'Kasyapa';
  inputMobile.value = activeProfile.general.mobile || '';
  inputCountry.value = activeProfile.general.country || 'India';
  inputState.value = activeProfile.general.state || '';
  inputCity.value = activeProfile.general.city || '';
  inputPincode.value = activeProfile.general.pincode || '';

  // Volunteer
  inputProfession.value = activeProfile.volunteer.profession || '';
  inputEducation.value = activeProfile.volunteer.education || '';
  inputLanguages.value = activeProfile.volunteer.languages || '';
  inputVolunteerExp.value = activeProfile.volunteer.volunteerExperience || '';
  inputLocation.value = activeProfile.volunteer.preferredLocation || '';
  inputFrequency.value = activeProfile.volunteer.frequency || '';

  // Settings
  checkFillContinue.checked = appState.settings.fillAndContinueEnabled;
  checkFocusCaptcha.checked = appState.settings.autoFocusCaptcha;
  inputTargetTime.value = appState.settings.targetReleaseTime || '10:00:00';

  renderPilgrims();
}

/**
 * Renders Pilgrims List with drag-reorder and live Verhoeff feedback
 */
function renderPilgrims(): void {
  if (!activeProfile) return;
  const currentProfile = activeProfile;

  pilgrimsContainer.innerHTML = '';
  const pilgrims = currentProfile.pilgrims;
  const includedCount = pilgrims.filter(p => p.included).length;
  pilgrimCountBadge.textContent = String(includedCount);

  pilgrims.forEach((pilgrim, idx) => {
    const card = document.createElement('div');
    card.className = 'pilgrim-card';

    const aadhaarCheck = pilgrim.idProofType === 'Aadhaar' && pilgrim.idNumber
      ? validateAadhaar(pilgrim.idNumber)
      : null;

    // Special Darshan Section on Primary Pilgrim
    let specialDarshanHtml = '';
    if (idx === 0) {
      const cooldownInfo = pilgrim.lastSpecialDarshanDate
        ? checkSpecialDarshanCooldown(pilgrim.lastSpecialDarshanDate)
        : null;

      const isSpecialPreset = currentProfile.bookingPreset === 'SPECIAL_DISABILITY_AGED';

      specialDarshanHtml = `
        <details class="special-darshan-box" ${isSpecialPreset ? 'open' : ''}>
          <summary>♿ Special Darshan Details & Docs (&lt;1 MB)</summary>
          <div class="form-grid" style="margin-top: 8px;">
            <div class="form-group">
              <label>Special Category</label>
              <select class="select-special-category">
                <option value="Differently Abled" ${(pilgrim.specialCategory || 'Differently Abled') === 'Differently Abled' ? 'selected' : ''}>Differently Abled</option>
                <option value="Senior Citizen" ${pilgrim.specialCategory === 'Senior Citizen' ? 'selected' : ''}>Senior Citizen (65+)</option>
                <option value="Medical Cases" ${pilgrim.specialCategory === 'Medical Cases' ? 'selected' : ''}>Medical Cases</option>
              </select>
            </div>

            <div class="form-group">
              <label>Date of Birth (DOB)</label>
              <input type="date" class="input-dob" value="${pilgrim.dob || ''}">
            </div>

            <div class="form-group box-differently-abled" style="display: ${(pilgrim.specialCategory || 'Differently Abled') === 'Differently Abled' ? 'flex' : 'none'};">
              <label>Disability Type *</label>
              <select class="select-disability-type">
                <option value="Orthopedic / Locomotor" ${(pilgrim.disabilityType || 'Orthopedic / Locomotor') === 'Orthopedic / Locomotor' ? 'selected' : ''}>Orthopedic / Locomotor</option>
                <option value="Visual Impairment" ${pilgrim.disabilityType === 'Visual Impairment' ? 'selected' : ''}>Visual Impairment</option>
                <option value="Hearing Impairment" ${pilgrim.disabilityType === 'Hearing Impairment' ? 'selected' : ''}>Hearing Impairment</option>
                <option value="Mental / Intellectual" ${pilgrim.disabilityType === 'Mental / Intellectual' ? 'selected' : ''}>Mental / Intellectual</option>
                <option value="Speech & Language" ${pilgrim.disabilityType === 'Speech & Language' ? 'selected' : ''}>Speech & Language</option>
                <option value="Multiple Disabilities" ${pilgrim.disabilityType === 'Multiple Disabilities' ? 'selected' : ''}>Multiple Disabilities</option>
                <option value="Other" ${pilgrim.disabilityType === 'Other' ? 'selected' : ''}>Other</option>
              </select>
            </div>

            <div class="form-group box-differently-abled" style="display: ${(pilgrim.specialCategory || 'Differently Abled') === 'Differently Abled' ? 'flex' : 'none'};">
              <label>Disability Percentage (%)</label>
              <input type="number" class="input-disability-percentage" min="1" max="100" value="${pilgrim.disabilityPercentage !== undefined ? pilgrim.disabilityPercentage : ''}" placeholder="e.g. 40">
              ${(typeof pilgrim.disabilityPercentage === 'number' && pilgrim.disabilityPercentage <= 20) ? '<span class="cooldown-badge">⚠️ &gt;20% cited by many TTD guides</span>' : ''}
            </div>

            <div class="form-group full-width box-differently-abled" style="display: ${(pilgrim.specialCategory || 'Differently Abled') === 'Differently Abled' ? 'flex' : 'none'};">
              <label>Govt Certificate / UDID Card Number</label>
              <input type="text" class="input-udid-number" value="${pilgrim.certificateOrUdidNumber || ''}" placeholder="UDID Number or Reg No">
            </div>

            <div class="form-group full-width box-medical" style="display: ${pilgrim.specialCategory === 'Medical Cases' ? 'flex' : 'none'};">
              <label>Medical Condition / Surgery *</label>
              <select class="select-medical-condition">
                <option value="Kidney Transplantation" ${(pilgrim.medicalCondition || 'Kidney Transplantation') === 'Kidney Transplantation' ? 'selected' : ''}>Kidney Transplantation</option>
                <option value="Open Heart Surgery" ${pilgrim.medicalCondition === 'Open Heart Surgery' ? 'selected' : ''}>Open Heart Surgery</option>
                <option value="Dialysis" ${pilgrim.medicalCondition === 'Dialysis' ? 'selected' : ''}>Dialysis</option>
                <option value="Liver Transplantation" ${pilgrim.medicalCondition === 'Liver Transplantation' ? 'selected' : ''}>Liver Transplantation</option>
                <option value="Brain Surgery" ${pilgrim.medicalCondition === 'Brain Surgery' ? 'selected' : ''}>Brain Surgery</option>
                <option value="Cancer" ${pilgrim.medicalCondition === 'Cancer' ? 'selected' : ''}>Cancer</option>
                <option value="Spine Surgery (Unable to Walk)" ${pilgrim.medicalCondition === 'Spine Surgery (Unable to Walk)' ? 'selected' : ''}>Spine Surgery (Unable to Walk)</option>
                <option value="Other" ${pilgrim.medicalCondition === 'Other' ? 'selected' : ''}>Other</option>
              </select>
            </div>

            <div class="form-group full-width">
              <label>Last Special Darshan Date (90-Day Cooldown Check)</label>
              <input type="date" class="input-last-darshan-date" value="${pilgrim.lastSpecialDarshanDate || ''}">
              ${cooldownInfo?.inCooldown ? `<span class="cooldown-badge">${cooldownInfo.message}</span>` : ''}
            </div>

            <!-- Attendant Config -->
            <div class="form-group full-width" style="border-top: 1px solid var(--border-color); padding-top: 8px;">
              <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                <input type="checkbox" class="check-attendant-required" ${currentProfile.attendantConfig?.requiresAttendant ? 'checked' : ''}>
                <span>Enable Attendant / Companion (Max 1 Person)</span>
              </label>
              <div class="attendant-options-box" style="display: ${currentProfile.attendantConfig?.requiresAttendant ? 'block' : 'none'}; margin-top:6px;">
                <label>Companion Relationship:</label>
                <select class="select-companion-rel" style="margin-top:2px;">
                  <option value="Spouse" ${(currentProfile.attendantConfig?.companionRelationship || 'Spouse') === 'Spouse' ? 'selected' : ''}>Spouse</option>
                  <option value="Dependent Caretaker (Severe Illness / 80+)" ${currentProfile.attendantConfig?.companionRelationship === 'Dependent Caretaker (Severe Illness / 80+)' ? 'selected' : ''}>Dependent Caretaker (Severe Illness / 80+)</option>
                  <option value="Other" ${currentProfile.attendantConfig?.companionRelationship === 'Other' ? 'selected' : ''}>Other</option>
                </select>
                ${(currentProfile.attendantConfig?.companionRelationship && currentProfile.attendantConfig.companionRelationship !== 'Spouse') ? `
                  <div class="spouse-advisory">
                    ⚠️ TTD's official rule allows Only Spouse as attendant (exceptions apply only to severe illness/mental disability or 80+ cases with prior verification).
                  </div>
                ` : ''}
              </div>
            </div>

            <!-- Documents Upload Section (< 1 MB strict) -->
            <div class="form-group full-width" style="border-top: 1px solid var(--border-color); padding-top: 8px;">
              <label><strong>Stored Proof Documents (&lt; 1 MB Local Encrypted)</strong></label>

              <!-- Aadhaar / ID Proof Doc -->
              <div class="doc-upload-box">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                  <span style="font-weight:600; font-size:11px;">1. Aadhaar / ID Proof Doc:</span>
                  <span class="doc-status-badge ${pilgrim.proofDocuments?.idProofDoc ? 'attached' : 'empty'}">
                    ${pilgrim.proofDocuments?.idProofDoc ? `✓ ${pilgrim.proofDocuments.idProofDoc.fileName} (${Math.round(pilgrim.proofDocuments.idProofDoc.sizeBytes/1024)} KB / 1024 KB max)` : 'No file attached'}
                  </span>
                </div>
                <input type="file" class="file-input-aadhaar" accept=".pdf,.jpg,.jpeg,.png" style="display:none;">
                <div style="display:flex; gap:6px; margin-top:4px;">
                  <button type="button" class="btn-sec small btn-choose-aadhaar">📁 Choose &lt;1MB File</button>
                  ${pilgrim.proofDocuments?.idProofDoc ? `<button type="button" class="btn-sec small danger btn-remove-aadhaar">✕ Remove</button>` : ''}
                </div>
              </div>

              <!-- Certificate / Medical Doc -->
              <div class="doc-upload-box">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                  <span style="font-weight:600; font-size:11px;">2. Disability / Medical Certificate:</span>
                  <span class="doc-status-badge ${pilgrim.proofDocuments?.categoryCertificateDoc ? 'attached' : 'empty'}">
                    ${pilgrim.proofDocuments?.categoryCertificateDoc ? `✓ ${pilgrim.proofDocuments.categoryCertificateDoc.fileName} (${Math.round(pilgrim.proofDocuments.categoryCertificateDoc.sizeBytes/1024)} KB / 1024 KB max)` : 'No file attached'}
                  </span>
                </div>
                <input type="file" class="file-input-cert" accept=".pdf,.jpg,.jpeg,.png" style="display:none;">
                <div style="display:flex; gap:6px; margin-top:4px;">
                  <button type="button" class="btn-sec small btn-choose-cert">📁 Choose &lt;1MB File</button>
                  ${pilgrim.proofDocuments?.categoryCertificateDoc ? `<button type="button" class="btn-sec small danger btn-remove-cert">✕ Remove</button>` : ''}
                </div>
              </div>

            </div>
          </div>
        </details>
      `;
    }

    card.innerHTML = `
      <div class="pilgrim-card-header">
        <label class="pilgrim-checkbox-label">
          <input type="checkbox" class="pilgrim-included-check" ${pilgrim.included ? 'checked' : ''}>
          <span>Pilgrim ${idx + 1} ${pilgrim.fullName ? `(${pilgrim.fullName})` : ''}</span>
        </label>
        <div class="card-actions">
          <button class="btn-card-nav btn-move-up" ${idx === 0 ? 'disabled' : ''} title="Move Up">▲</button>
          <button class="btn-card-nav btn-move-down" ${idx === pilgrims.length - 1 ? 'disabled' : ''} title="Move Down">▼</button>
          <button class="btn-card-nav danger btn-delete-pilgrim" title="Delete Pilgrim">✕</button>
        </div>
      </div>

      <div class="form-grid">
        <div class="form-group full-width">
          <label>Full Name (as on Gov Photo ID) *</label>
          <input type="text" class="input-name" value="${pilgrim.fullName || ''}" placeholder="Exact name on ID">
        </div>

        <div class="form-group">
          <label>Age (0-120) *</label>
          <input type="number" class="input-age" value="${pilgrim.age !== '' ? pilgrim.age : ''}" min="0" max="120" placeholder="Age">
        </div>

        <div class="form-group">
          <label>Gender *</label>
          <select class="select-gender">
            <option value="Male" ${pilgrim.gender === 'Male' ? 'selected' : ''}>Male</option>
            <option value="Female" ${pilgrim.gender === 'Female' ? 'selected' : ''}>Female</option>
            <option value="Transgender" ${pilgrim.gender === 'Transgender' ? 'selected' : ''}>Transgender</option>
          </select>
        </div>

        <div class="form-group">
          <label>ID Proof Type *</label>
          <select class="select-id-type">
            <option value="Aadhaar" ${pilgrim.idProofType === 'Aadhaar' ? 'selected' : ''}>Aadhaar</option>
            <option value="Passport" ${pilgrim.idProofType === 'Passport' ? 'selected' : ''}>Passport</option>
            <option value="Voter ID" ${pilgrim.idProofType === 'Voter ID' ? 'selected' : ''}>Voter ID</option>
            <option value="Driving License" ${pilgrim.idProofType === 'Driving License' ? 'selected' : ''}>Driving License</option>
            <option value="PAN" ${pilgrim.idProofType === 'PAN' ? 'selected' : ''}>PAN</option>
          </select>
        </div>

        <div class="form-group">
          <label>ID Number *</label>
          <input type="text" class="input-id-number" value="${pilgrim.idNumber || ''}" placeholder="${pilgrim.idProofType === 'Aadhaar' ? '12 digits' : 'ID Number'}">
          ${aadhaarCheck ? `
            <div class="verhoeff-tag ${aadhaarCheck.valid ? 'valid' : 'invalid'}">
              ${aadhaarCheck.valid ? '✓ Valid Verhoeff Aadhaar' : `✗ ${aadhaarCheck.error}`}
            </div>
          ` : ''}
        </div>

        <div class="form-group full-width">
          <label>Gothram (Sri Srinivasa Divyanugraha Homam & Sevas)</label>
          <input type="text" class="input-gothram" value="${pilgrim.gothram || ''}" placeholder="e.g. Kasyapa, Bharadwaja">
        </div>
      </div>
      ${specialDarshanHtml}
    `;

    // Pilgrim Event Listeners
    const includedCheck = card.querySelector('.pilgrim-included-check') as HTMLInputElement;
    includedCheck.addEventListener('change', () => {
      pilgrim.included = includedCheck.checked;
      renderProfileSelector();
      pilgrimCountBadge.textContent = String(activeProfile?.pilgrims.filter(p => p.included).length || 0);
      scheduleAutoSave();
    });

    const moveUpBtn = card.querySelector('.btn-move-up') as HTMLButtonElement;
    moveUpBtn.addEventListener('click', () => {
      if (idx > 0) {
        const temp = pilgrims[idx];
        pilgrims[idx] = pilgrims[idx - 1];
        pilgrims[idx - 1] = temp;
        renderPilgrims();
        scheduleAutoSave();
      }
    });

    const moveDownBtn = card.querySelector('.btn-move-down') as HTMLButtonElement;
    moveDownBtn.addEventListener('click', () => {
      if (idx < pilgrims.length - 1) {
        const temp = pilgrims[idx];
        pilgrims[idx] = pilgrims[idx + 1];
        pilgrims[idx + 1] = temp;
        renderPilgrims();
        scheduleAutoSave();
      }
    });

    const deleteBtn = card.querySelector('.btn-delete-pilgrim') as HTMLButtonElement;
    deleteBtn.addEventListener('click', () => {
      if (pilgrims.length <= 1) {
        alert('You must have at least one pilgrim.');
        return;
      }
      activeProfile!.pilgrims.splice(idx, 1);
      renderPilgrims();
      renderProfileSelector();
      scheduleAutoSave();
    });

    const inputName = card.querySelector('.input-name') as HTMLInputElement;
    inputName.addEventListener('input', () => {
      pilgrim.fullName = inputName.value.trim();
      scheduleAutoSave();
    });

    const inputAge = card.querySelector('.input-age') as HTMLInputElement;
    inputAge.addEventListener('input', () => {
      pilgrim.age = inputAge.value === '' ? '' : parseInt(inputAge.value, 10);
      scheduleAutoSave();
    });

    const selectGender = card.querySelector('.select-gender') as HTMLSelectElement;
    selectGender.addEventListener('change', () => {
      pilgrim.gender = selectGender.value as any;
      scheduleAutoSave();
    });

    const selectIdType = card.querySelector('.select-id-type') as HTMLSelectElement;
    selectIdType.addEventListener('change', () => {
      pilgrim.idProofType = selectIdType.value as any;
      renderPilgrims();
      scheduleAutoSave();
    });

    const inputIdNum = card.querySelector('.input-id-number') as HTMLInputElement;
    inputIdNum.addEventListener('input', () => {
      pilgrim.idNumber = inputIdNum.value.trim();
      scheduleAutoSave();
    });

    const inputGothram = card.querySelector('.input-gothram') as HTMLInputElement;
    inputGothram.addEventListener('input', () => {
      pilgrim.gothram = inputGothram.value.trim();
      scheduleAutoSave();
    });

    // Special Darshan & Documents Listeners (Primary Pilgrim only)
    if (idx === 0) {
      const selectSpecialCat = card.querySelector('.select-special-category') as HTMLSelectElement | null;
      const inputDob = card.querySelector('.input-dob') as HTMLInputElement | null;
      const selectDisabilityType = card.querySelector('.select-disability-type') as HTMLSelectElement | null;
      const inputDisabilityPct = card.querySelector('.input-disability-percentage') as HTMLInputElement | null;
      const inputUdidNum = card.querySelector('.input-udid-number') as HTMLInputElement | null;
      const selectMedicalCond = card.querySelector('.select-medical-condition') as HTMLSelectElement | null;
      const inputLastDarshanDate = card.querySelector('.input-last-darshan-date') as HTMLInputElement | null;
      const checkAttendantReq = card.querySelector('.check-attendant-required') as HTMLInputElement | null;
      const selectCompanionRel = card.querySelector('.select-companion-rel') as HTMLSelectElement | null;

      selectSpecialCat?.addEventListener('change', () => {
        pilgrim.specialCategory = selectSpecialCat.value as any;
        renderPilgrims();
        scheduleAutoSave();
        updateReadiness();
      });

      inputDob?.addEventListener('input', () => {
        pilgrim.dob = inputDob.value.trim();
        scheduleAutoSave();
      });

      selectDisabilityType?.addEventListener('change', () => {
        pilgrim.disabilityType = selectDisabilityType.value as any;
        scheduleAutoSave();
        updateReadiness();
      });

      inputDisabilityPct?.addEventListener('input', () => {
        const val = inputDisabilityPct.value === '' ? undefined : parseInt(inputDisabilityPct.value, 10);
        pilgrim.disabilityPercentage = val;
        scheduleAutoSave();
        updateReadiness();
      });

      inputUdidNum?.addEventListener('input', () => {
        pilgrim.certificateOrUdidNumber = inputUdidNum.value.trim();
        scheduleAutoSave();
      });

      selectMedicalCond?.addEventListener('change', () => {
        pilgrim.medicalCondition = selectMedicalCond.value as any;
        scheduleAutoSave();
        updateReadiness();
      });

      inputLastDarshanDate?.addEventListener('change', () => {
        pilgrim.lastSpecialDarshanDate = inputLastDarshanDate.value;
        renderPilgrims();
        scheduleAutoSave();
        updateReadiness();
      });

      checkAttendantReq?.addEventListener('change', () => {
        if (!activeProfile!.attendantConfig) {
          activeProfile!.attendantConfig = { requiresAttendant: false, companionRelationship: 'Spouse' };
        }
        activeProfile!.attendantConfig.requiresAttendant = checkAttendantReq.checked;
        renderPilgrims();
        scheduleAutoSave();
        updateReadiness();
      });

      selectCompanionRel?.addEventListener('change', () => {
        if (!activeProfile!.attendantConfig) {
          activeProfile!.attendantConfig = { requiresAttendant: false, companionRelationship: 'Spouse' };
        }
        activeProfile!.attendantConfig.companionRelationship = selectCompanionRel.value as any;
        renderPilgrims();
        scheduleAutoSave();
        updateReadiness();
      });

      // Document Uploads
      const fileInputAadhaar = card.querySelector('.file-input-aadhaar') as HTMLInputElement | null;
      const btnChooseAadhaar = card.querySelector('.btn-choose-aadhaar') as HTMLButtonElement | null;
      const btnRemoveAadhaar = card.querySelector('.btn-remove-aadhaar') as HTMLButtonElement | null;

      const fileInputCert = card.querySelector('.file-input-cert') as HTMLInputElement | null;
      const btnChooseCert = card.querySelector('.btn-choose-cert') as HTMLButtonElement | null;
      const btnRemoveCert = card.querySelector('.btn-remove-cert') as HTMLButtonElement | null;

      const processDocFile = async (file: File, docKey: 'idProofDoc' | 'categoryCertificateDoc') => {
        if (!pilgrim.proofDocuments) pilgrim.proofDocuments = {};

        const isImage = file.type.startsWith('image/');
        const isPdf = file.type === 'application/pdf';

        if (!isImage && !isPdf) {
          alert('Invalid file format. Please upload a PDF, JPEG, or PNG file.');
          return;
        }

        // If image is over 900 KB, automatically compress via canvas
        if (isImage && file.size > 900 * 1024) {
          try {
            const compressed = await compressImage(file);
            pilgrim.proofDocuments[docKey] = compressed;
            renderPilgrims();
            scheduleAutoSave();
            updateReadiness();
            return;
          } catch (e) {
            console.warn('Canvas compression error, checking file size:', e);
          }
        }

        // Validate size < 1 MB
        if (file.size >= MAX_DOC_SIZE_BYTES) {
          alert(`File is too large (${(file.size / 1024).toFixed(0)} KB). Maximum allowed size is 1024 KB (1 MB). Please choose a smaller file.`);
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const cleanBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
          pilgrim.proofDocuments![docKey] = {
            fileName: file.name,
            mimeType: file.type as any,
            sizeBytes: file.size,
            base64Data: cleanBase64
          };
          renderPilgrims();
          scheduleAutoSave();
          updateReadiness();
        };
        reader.readAsDataURL(file);
      };

      btnChooseAadhaar?.addEventListener('click', () => fileInputAadhaar?.click());
      fileInputAadhaar?.addEventListener('change', () => {
        const file = fileInputAadhaar.files?.[0];
        if (file) processDocFile(file, 'idProofDoc');
      });
      btnRemoveAadhaar?.addEventListener('click', () => {
        if (pilgrim.proofDocuments) delete pilgrim.proofDocuments.idProofDoc;
        renderPilgrims();
        scheduleAutoSave();
        updateReadiness();
      });

      btnChooseCert?.addEventListener('click', () => fileInputCert?.click());
      fileInputCert?.addEventListener('change', () => {
        const file = fileInputCert.files?.[0];
        if (file) processDocFile(file, 'categoryCertificateDoc');
      });
      btnRemoveCert?.addEventListener('click', () => {
        if (pilgrim.proofDocuments) delete pilgrim.proofDocuments.categoryCertificateDoc;
        renderPilgrims();
        scheduleAutoSave();
        updateReadiness();
      });
    }

    pilgrimsContainer.appendChild(card);
  });
}

/**
 * Renders Quick Copy Fallback list
 */
function renderQuickCopyList(): void {
  const container = document.getElementById('quick-copy-container');
  if (!container || !activeProfile) return;

  container.innerHTML = '';
  const items: { label: string; value: string }[] = [];

  activeProfile.pilgrims.filter(p => p.included).forEach((p, idx) => {
    if (p.fullName) items.push({ label: `P${idx + 1} Name`, value: p.fullName });
    if (p.age !== '') items.push({ label: `P${idx + 1} Age`, value: String(p.age) });
    if (p.idNumber) {
      items.push({
        label: `P${idx + 1} ${p.idProofType}`,
        value: p.idProofType === 'Aadhaar' ? p.idNumber.replace(/[\s-]/g, '') : p.idNumber
      });
    }
  });

  if (activeProfile.general.email) items.push({ label: 'Email', value: activeProfile.general.email });
  if (activeProfile.general.mobile) items.push({ label: 'Mobile', value: activeProfile.general.mobile });
  if (activeProfile.general.pincode) items.push({ label: 'Pincode', value: activeProfile.general.pincode });

  if (items.length === 0) {
    container.innerHTML = '<div class="helper-text">No details filled yet.</div>';
    return;
  }

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'quick-copy-item';
    row.innerHTML = `
      <div>
        <div style="font-weight: 600; font-size: 11px;">${item.label}</div>
        <div style="font-family: monospace; font-size: 12px; color: var(--primary-color);">${item.value}</div>
      </div>
      <button class="btn-copy">Copy</button>
    `;
    row.querySelector('.btn-copy')?.addEventListener('click', async (e) => {
      await navigator.clipboard.writeText(item.value);
      const btn = e.target as HTMLButtonElement;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
    });
    container.appendChild(row);
  });
}

/**
 * Updates Top Readiness Banner
 */
function updateReadiness(): void {
  if (!activeProfile) return;

  const report = evaluateBookingReadiness(activeProfile);

  if (report.isReady) {
    readinessBanner.className = 'readiness-banner ready';
    readinessTitle.innerHTML = `✅ Ready for Booking (${report.includedCount} pilgrim${report.includedCount !== 1 ? 's' : ''} valid)`;
    readinessErrors.innerHTML = report.warnings.length > 0
      ? report.warnings.map(w => `<div>ℹ️ ${w}</div>`).join('')
      : '<div>All pilgrim fields, contact details, and ID checksums validated.</div>';
  } else {
    readinessBanner.className = 'readiness-banner not-ready';
    readinessTitle.innerHTML = `⚠️ Profile Incomplete (${report.includedCount} pilgrim${report.includedCount !== 1 ? 's' : ''} selected)`;

    const errorList: string[] = [...report.generalErrors];
    Object.entries(report.pilgrimErrors).forEach(([pilgrimId, errs]) => {
      const p = activeProfile?.pilgrims.find(item => item.id === pilgrimId);
      const name = p?.fullName || 'Unnamed';
      errs.forEach(err => errorList.push(`${name}: ${err}`));
    });

    readinessErrors.innerHTML = errorList.map(err => `<div>❌ ${err}</div>`).join('');
  }
}

// Start
document.addEventListener('DOMContentLoaded', init);
