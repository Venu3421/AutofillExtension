import { Profile, CustomFieldMapping, ExtensionSettings, Pilgrim } from '../models/schema';
import { DetectedFormState, createCustomMapping, computeCssSelector } from './field-detector';
import { AuditReport, QuickPasteController, TypeAssistController, executeTier1Autofill } from './fill-engine';
import { evaluateBookingReadiness, checkTicketCountMismatch } from '../validation/validators';

function formatFieldKeyLabel(key: string, pilgrims: Pilgrim[] = []): string {
  if (key === 'general_gothram') return 'General Details - Gothram';
  if (key === 'general_email') return 'General Details - Email';
  if (key === 'general_mobile') return 'General Details - Mobile';
  if (key === 'general_city') return 'General Details - City';
  if (key === 'general_state') return 'General Details - State';
  if (key === 'general_country') return 'General Details - Country';
  if (key === 'general_pincode') return 'General Details - Pincode';

  if (key === 'special_category') return 'Special Darshan - Category';
  if (key === 'special_disabilityType') return 'Special Darshan - Disability Type';
  if (key === 'special_disabilityPercentage') return 'Special Darshan - Disability %';
  if (key === 'special_medicalCondition') return 'Special Darshan - Medical Condition';
  if (key === 'special_certificateOrUdidNumber') return 'Special Darshan - Certificate / UDID No';
  if (key === 'special_attendantRequired') return 'Special Darshan - Attendant Required (Yes/No)';
  if (key === 'doc_id_proof') return 'Devotee 1 - ID Proof Document Upload (<1MB)';
  if (key === 'doc_category_cert') return 'Devotee 1 - Certificate Document Upload (<1MB)';

  const match = key.match(/^pilgrim_(\d+)_(.+)$/);
  if (match) {
    const idx = parseInt(match[1], 10);
    const field = match[2];
    const pilgrimName = pilgrims[idx]?.fullName ? ` (${pilgrims[idx].fullName.split(' ')[0]})` : '';
    const devoteeNum = idx + 1;

    switch (field) {
      case 'fullName': return `Devotee ${devoteeNum}${pilgrimName} - Full Name`;
      case 'age': return `Devotee ${devoteeNum} - Age`;
      case 'dob': return `Devotee ${devoteeNum} - Date of Birth`;
      case 'gender': return `Devotee ${devoteeNum} - Gender`;
      case 'idProofType': return `Devotee ${devoteeNum} - Photo ID Proof`;
      case 'idNumber': return `Devotee ${devoteeNum} - Photo ID Number`;
      case 'gothram': return `Devotee ${devoteeNum} - Gothram`;
      default: return `Devotee ${devoteeNum} - ${field}`;
    }
  }
  return key;
}

export class FloatingPanel {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private activeProfile: Profile | null = null;
  private settings: ExtensionSettings | null = null;
  private formState: DetectedFormState | null = null;
  private isCollapsed: boolean = false;
  private istInterval: number | null = null;
  private errorCheckInterval: number | null = null;

  // Controllers
  private quickPasteController: QuickPasteController | null = null;
  private typeAssistController: TypeAssistController | null = null;
  private isMappingActive: boolean = false;
  private selectedMappingKey: string = 'pilgrim_0_fullName';

  // Draggable state
  private customPosition: { top: number; left: number } | null = null;
  private isDragging: boolean = false;
  private dragMoved: boolean = false;

  constructor(
    private onFillRequested: (mode: 'auto' | 'auto_continue') => void,
    private onProfileChanged: (profileId: string) => void,
    private onMappingSaved: (mapping: CustomFieldMapping) => void,
    private onExportMappings: () => void,
    private onRescanRequested?: () => DetectedFormState,
    private onClearMappings?: () => void
  ) {}

  public mount(profile: Profile, settings: ExtensionSettings, formState: DetectedFormState): void {
    if (this.host) return; // Already mounted

    this.activeProfile = profile;
    this.settings = settings;
    this.formState = formState;

    this.host = document.createElement('pilgrim-quickfill-root');
    this.host.id = 'pilgrim-quickfill-extension-host';
    this.host.style.setProperty('position', 'fixed', 'important');
    this.host.style.setProperty('bottom', '20px', 'important');
    this.host.style.setProperty('right', '20px', 'important');
    this.host.style.setProperty('z-index', '2147483647', 'important');
    this.host.style.setProperty('display', 'block', 'important');
    this.host.style.setProperty('pointer-events', 'auto', 'important');
    this.host.style.setProperty('margin', '0', 'important');
    this.host.style.setProperty('padding', '0', 'important');
    this.host.style.setProperty('font-family', 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', 'important');

    this.shadow = this.host.attachShadow({ mode: 'open' });
    const targetParent = document.body || document.documentElement;
    if (targetParent) {
      targetParent.appendChild(this.host);
    }

    // Restore any previously dragged position within the session (with bounds validation)
    try {
      const savedPos = sessionStorage.getItem('pilgrim_quickfill_pos');
      if (savedPos) {
        const parsed = JSON.parse(savedPos);
        if (
          parsed &&
          typeof parsed.top === 'number' &&
          !isNaN(parsed.top) &&
          typeof parsed.left === 'number' &&
          !isNaN(parsed.left) &&
          parsed.top >= 0 &&
          parsed.top < (window.innerHeight || 800) - 50 &&
          parsed.left >= 0 &&
          parsed.left < (window.innerWidth || 1200) - 50
        ) {
          this.customPosition = parsed;
        } else {
          sessionStorage.removeItem('pilgrim_quickfill_pos');
          this.customPosition = null;
        }
      }
    } catch (e) {
      this.customPosition = null;
    }

    this.applyPosition();
    this.render();
    this.startISTClock();
    this.startErrorHelperScanner();
  }

  private applyPosition(): void {
    if (!this.host) return;
    if (
      this.customPosition &&
      typeof this.customPosition.top === 'number' &&
      !isNaN(this.customPosition.top) &&
      typeof this.customPosition.left === 'number' &&
      !isNaN(this.customPosition.left)
    ) {
      this.host.style.setProperty('top', `${this.customPosition.top}px`, 'important');
      this.host.style.setProperty('left', `${this.customPosition.left}px`, 'important');
      this.host.style.setProperty('bottom', 'auto', 'important');
      this.host.style.setProperty('right', 'auto', 'important');
    } else {
      this.host.style.setProperty('bottom', '20px', 'important');
      this.host.style.setProperty('right', '20px', 'important');
      this.host.style.setProperty('top', 'auto', 'important');
      this.host.style.setProperty('left', 'auto', 'important');
    }
  }

  public update(profile: Profile, settings: ExtensionSettings, formState: DetectedFormState): void {
    const prevPilgrimCount = this.activeProfile?.pilgrims.filter(p => p.included).length;
    const prevRowCount = this.formState?.pilgrimRowsCount;
    this.activeProfile = profile;
    this.settings = settings;
    this.formState = formState;

    // Never re-render the whole shadow DOM while the user is actively mapping fields or using an assist!
    // Re-rendering innerHTML snaps open select dropdowns shut immediately!
    if (this.isMappingActive || this.quickPasteController || this.typeAssistController) {
      return;
    }

    const newPilgrimCount = profile.pilgrims.filter(p => p.included).length;
    const newRowCount = formState.pilgrimRowsCount;

    // Only full re-render when counts change, otherwise keep existing DOM intact
    if (prevPilgrimCount !== newPilgrimCount || prevRowCount !== newRowCount) {
      this.render();
    }
  }

  public updateAudit(audit: AuditReport): void {
    if (!this.shadow) return;
    const tray = this.shadow.querySelector('#audit-tray');
    if (!tray) return;

    if (audit.hasFailures) {
      tray.innerHTML = `
        <div class="audit-banner fail">
          <div class="audit-title">⚠️ Audit: ${audit.failureCount} field(s) rejected or cleared!</div>
          <div class="audit-list">
            ${audit.items.filter(i => i.status !== 'success').map(i => `
              <div class="audit-item">❌ <strong>${i.label}</strong>: ${i.errorMessage || 'cleared'}</div>
            `).join('')}
          </div>
          <button id="btn-finish-paste" class="btn-sub">📋 Finish via Quick Paste</button>
          <button id="btn-finish-type" class="btn-sub">⌨️ Finish via Type Assist</button>
        </div>
      `;
      this.shadow.querySelector('#btn-finish-paste')?.addEventListener('click', () => this.startQuickPaste());
      this.shadow.querySelector('#btn-finish-type')?.addEventListener('click', () => this.startTypeAssist());
    } else {
      tray.innerHTML = `
        <div class="audit-banner pass">
          ✅ All ${audit.successCount} fields filled & verified!
          ${audit.captchaFocused ? '<div style="margin-top:4px; font-weight:700;">🔒 Please enter CAPTCHA characters to complete booking (Security policies prevent auto-solving CAPTCHAs).</div>' : ''}
        </div>
      `;
      setTimeout(() => {
        if (tray) tray.innerHTML = '';
      }, 6000);
    }
  }

  private startISTClock(): void {
    const updateTime = () => {
      if (!this.shadow) return;
      const el = this.shadow.querySelector('#ist-clock');
      const timerEl = this.shadow.querySelector('#countdown-timer');
      if (!el) return;

      const now = new Date();
      // IST is UTC + 5:30
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      const istTime = new Date(utc + (3600000 * 5.5));
      const hours = String(istTime.getHours()).padStart(2, '0');
      const minutes = String(istTime.getMinutes()).padStart(2, '0');
      const seconds = String(istTime.getSeconds()).padStart(2, '0');

      el.textContent = `${hours}:${minutes}:${seconds} IST`;

      // Optional Countdown
      if (timerEl && this.settings?.targetReleaseTime) {
        const parts = this.settings.targetReleaseTime.split(':').map(Number);
        if (parts.length >= 2) {
          const target = new Date(istTime);
          target.setHours(parts[0], parts[1], parts[2] || 0, 0);
          let diffMs = target.getTime() - istTime.getTime();
          if (diffMs > 0 && diffMs < 3600000 * 4) { // within 4 hours
            const m = Math.floor((diffMs / 60000) % 60);
            const s = Math.floor((diffMs / 1000) % 60);
            timerEl.textContent = `⏳ Drop in ${m}m ${s}s`;
            timerEl.className = 'timer-pill active';
          } else {
            timerEl.textContent = '';
            timerEl.className = 'timer-pill';
          }
        }
      }
    };
    updateTime();
    this.istInterval = window.setInterval(updateTime, 1000);
  }

  private startErrorHelperScanner(): void {
    const checkErrors = () => {
      if (!this.shadow) return;
      const banner = this.shadow.querySelector('#ttd-error-banner');
      if (!banner) return;

      const bodyText = document.body.innerText || '';
      let message = '';

      if (bodyText.includes('504 Gateway Time-out') || bodyText.includes('504 Gateway') || bodyText.includes('502 Bad Gateway')) {
        message = '🚨 TTD Server 504 Gateway Timeout: Server is heavily loaded. Do NOT close this tab. Wait 5-10s before retrying.';
      } else if (bodyText.includes('Payment gateway did not respond')) {
        message = '⚠️ Payment Gateway Lag: Wait 15 minutes before re-attempting booking to avoid duplicate deductions.';
      } else if (bodyText.includes('Same pilgrim ID is in progress') || bodyText.includes('ID is in progress')) {
        message = '⚠️ Same Pilgrim ID in progress: Another booking session has locked this ID. Wait ~10 minutes for lock expiration.';
      } else if (bodyText.includes('Quota is full') || bodyText.includes('Quota Full')) {
        message = '❌ Quota Full: The selected darshan slot is currently exhausted. Watch for unreleased quota drops.';
      }

      if (message) {
        banner.textContent = message;
        banner.classList.add('visible');
      } else {
        banner.classList.remove('visible');
      }
    };
    this.errorCheckInterval = window.setInterval(checkErrors, 2500);
  }

  private render(): void {
    if (!this.shadow || !this.activeProfile || !this.settings) return;

    this.applyPosition();

    const readiness = evaluateBookingReadiness(this.activeProfile);
    const includedPilgrims = this.activeProfile.pilgrims.filter(p => p.included);
    const mismatch = checkTicketCountMismatch(
      this.formState?.pilgrimRowsCount || 0,
      readiness.includedCount
    );

    const isDark = this.settings.theme === 'dark' || (this.settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    this.shadow.innerHTML = `
      <style>
        :host {
          position: fixed !important;
          bottom: 20px;
          right: 20px;
          z-index: 2147483647 !important;
          display: block !important;
          pointer-events: auto !important;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
          touch-action: none !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        .panel {
          width: 320px;
          background: ${isDark ? '#1e293b' : '#ffffff'};
          color: ${isDark ? '#f8fafc' : '#0f172a'};
          border: 1px solid ${isDark ? '#334155' : '#e2e8f0'};
          border-radius: 12px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
          overflow: hidden;
          font-size: 13px;
          line-height: 1.4;
          transition: width 0.2s ease;
        }
        .panel.collapsed {
          width: auto;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: ${isDark ? '#0f172a' : '#f1f5f9'};
          border-bottom: 1px solid ${isDark ? '#334155' : '#e2e8f0'};
          cursor: grab;
          user-select: none;
          touch-action: none;
        }
        .header:active {
          cursor: grabbing;
        }
        .drag-handle {
          display: inline-flex;
          align-items: center;
          color: ${isDark ? '#64748b' : '#94a3b8'};
          margin-right: 4px;
          font-size: 14px;
          line-height: 1;
          cursor: grab;
          user-select: none;
        }
        .title-group {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
        }
        .badge-ist {
          background: #dbeafe;
          color: #1e40af;
          padding: 2px 6px;
          border-radius: 4px;
          font-family: monospace;
          font-size: 11px;
          font-weight: 700;
        }
        .timer-pill.active {
          background: #fef3c7;
          color: #92400e;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
        }
        .controls-top {
          display: flex;
          gap: 4px;
        }
        .btn-icon {
          background: transparent;
          border: none;
          color: inherit;
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 4px;
        }
        .btn-icon:hover {
          background: ${isDark ? '#334155' : '#e2e8f0'};
        }
        .body {
          padding: 12px;
          display: ${this.isCollapsed ? 'none' : 'block'};
        }
        .row-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        .pill-status {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
        }
        .pill-status.ready {
          background: #dcfce7;
          color: #166534;
        }
        .pill-status.not-ready {
          background: #fee2e2;
          color: #991b1b;
        }
        .banner-mismatch {
          background: #fef2f2;
          color: #991b1b;
          border: 1px solid #fecaca;
          padding: 6px 8px;
          border-radius: 6px;
          margin-bottom: 10px;
          font-size: 11px;
          font-weight: 600;
        }
        .error-banner {
          display: none;
          background: #fffbeb;
          color: #b45309;
          border: 1px solid #fde68a;
          padding: 6px 8px;
          border-radius: 6px;
          margin-bottom: 10px;
          font-size: 11px;
        }
        .error-banner.visible {
          display: block;
        }
        .action-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
          margin-bottom: 10px;
        }
        .btn-primary {
          grid-column: span 2;
          background: #2563eb;
          color: white;
          border: none;
          padding: 8px 10px;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        .btn-primary:hover {
          background: #1d4ed8;
        }
        .btn-sec {
          background: ${isDark ? '#334155' : '#f1f5f9'};
          color: inherit;
          border: 1px solid ${isDark ? '#475569' : '#cbd5e1'};
          padding: 6px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
          font-weight: 500;
          text-align: center;
        }
        .btn-sec:hover {
          background: ${isDark ? '#475569' : '#e2e8f0'};
        }
        .assist-card {
          background: ${isDark ? '#0f172a' : '#f8fafc'};
          border: 2px solid #3b82f6;
          border-radius: 8px;
          padding: 10px;
          margin-top: 8px;
          text-align: center;
        }
        .assist-target {
          font-size: 18px;
          font-weight: 800;
          letter-spacing: 2px;
          font-family: monospace;
          margin: 6px 0;
          color: #2563eb;
        }
        .assist-target.typo {
          color: #dc2626;
          animation: shake 0.2s ease-in-out;
        }
        .assist-target.done {
          color: #16a34a;
        }
        .mapping-box {
          background: ${isDark ? '#334155' : '#f1f5f9'};
          padding: 8px;
          border-radius: 6px;
          margin-top: 8px;
        }
        .mapping-current {
          background: ${isDark ? '#1e3a8a' : '#dbeafe'};
          color: ${isDark ? '#93c5fd' : '#1e40af'};
          padding: 6px 8px;
          border-radius: 6px;
          font-size: 11px;
          margin-bottom: 8px;
          border: 1px solid ${isDark ? '#2563eb' : '#bfdbfe'};
        }
        .mapping-section-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #64748b;
          margin: 6px 0 3px 0;
        }
        .mapping-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-bottom: 4px;
        }
        .pill-target {
          background: ${isDark ? '#1e293b' : '#ffffff'};
          border: 1px solid ${isDark ? '#475569' : '#cbd5e1'};
          color: inherit;
          border-radius: 4px;
          padding: 3px 7px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .pill-target:hover {
          background: ${isDark ? '#334155' : '#e2e8f0'};
        }
        .pill-target.active {
          background: #2563eb !important;
          border-color: #1d4ed8 !important;
          color: #ffffff !important;
          font-weight: 700 !important;
          box-shadow: 0 0 0 1px #2563eb;
        }
        .audit-banner {
          padding: 6px 8px;
          border-radius: 6px;
          font-size: 11px;
          margin-top: 6px;
        }
        .audit-banner.pass {
          background: #dcfce7;
          color: #166534;
        }
        .audit-banner.fail {
          background: #fee2e2;
          color: #991b1b;
        }
        .audit-list {
          margin: 4px 0;
          max-height: 80px;
          overflow-y: auto;
        }
        .btn-sub {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          padding: 3px 6px;
          font-size: 10px;
          cursor: pointer;
          margin-right: 4px;
          margin-top: 4px;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
      </style>

      <div class="panel ${this.isCollapsed ? 'collapsed' : ''}">
        <div class="header" id="panel-header" title="Drag to move panel anywhere • Click to collapse/expand">
          <div class="title-group">
            <span class="drag-handle">⠿</span>
            <span>⚡ Pilgrim QuickFill</span>
            <span class="badge-ist" id="ist-clock">--:--:-- IST</span>
            <span class="timer-pill" id="countdown-timer"></span>
          </div>
          <div class="controls-top">
            <button class="btn-icon" id="btn-toggle-collapse" title="Collapse/Expand">
              ${this.isCollapsed ? '◀' : '▼'}
            </button>
          </div>
        </div>

        <div class="body">
          <div id="ttd-error-banner" class="error-banner"></div>

          ${mismatch.mismatch ? `
            <div class="banner-mismatch">
              ⚠️ ${mismatch.message}
            </div>
          ` : ''}

          <div class="row-info">
            <div>
              <strong>${this.activeProfile.name}</strong> (${readiness.includedCount} pilgrim${readiness.includedCount !== 1 ? 's' : ''})
            </div>
            <span class="pill-status ${readiness.isReady ? 'ready' : 'not-ready'}">
              ${readiness.isReady ? '● Ready' : '● Incomplete'}
            </span>
          </div>

          <div class="action-grid">
            <button class="btn-primary" id="btn-fill-all" title="Shortcut: Alt+A">
              ⚡ Fill All (Alt+A)
            </button>
            <button class="btn-sec" id="btn-quick-paste" title="Guided Quick Paste">
              📋 Quick Paste
            </button>
            <button class="btn-sec" id="btn-type-assist" title="Type Assist for blocked inputs">
              ⌨️ Type Assist
            </button>
            <button class="btn-sec" id="btn-start-mapping" title="Map missing fields on TTD">
              🎯 Map Field
            </button>
            <button class="btn-sec" id="btn-export-selectors" title="Export custom selectors for Phase 2">
              📤 Export Mappings
            </button>
            <button class="btn-sec" id="btn-clear-mappings" title="Reset custom mappings and use automatic detection">
              🗑️ Reset Mappings
            </button>
          </div>

          <!-- Interactive Click-to-Map UI (Hidden unless active) -->
          <div id="mapping-container" style="display: ${this.isMappingActive ? 'block' : 'none'};">
            <div class="mapping-box">
              <div style="font-weight: 700; margin-bottom: 6px; font-size: 12px; color: #2563eb;">
                🎯 Step 1: Select Field to Map:
              </div>

              <div class="mapping-current">
                Target: <strong id="mapping-target-name">${formatFieldKeyLabel(this.selectedMappingKey, includedPilgrims)}</strong>
              </div>

              ${includedPilgrims.map((p, idx) => `
                <div class="mapping-section-label">Devotee ${idx + 1} (${p.fullName || 'Pilgrim'}):</div>
                <div class="mapping-pills">
                  <button type="button" class="pill-target ${this.selectedMappingKey === `pilgrim_${idx}_fullName` ? 'active' : ''}" data-key="pilgrim_${idx}_fullName">Name</button>
                  <button type="button" class="pill-target ${this.selectedMappingKey === `pilgrim_${idx}_age` ? 'active' : ''}" data-key="pilgrim_${idx}_age">Age</button>
                  <button type="button" class="pill-target ${this.selectedMappingKey === `pilgrim_${idx}_dob` ? 'active' : ''}" data-key="pilgrim_${idx}_dob">DOB</button>
                  <button type="button" class="pill-target ${this.selectedMappingKey === `pilgrim_${idx}_gender` ? 'active' : ''}" data-key="pilgrim_${idx}_gender">Gender</button>
                  <button type="button" class="pill-target ${this.selectedMappingKey === `pilgrim_${idx}_idProofType` ? 'active' : ''}" data-key="pilgrim_${idx}_idProofType">ID Proof</button>
                  <button type="button" class="pill-target ${this.selectedMappingKey === `pilgrim_${idx}_idNumber` ? 'active' : ''}" data-key="pilgrim_${idx}_idNumber">ID Number</button>
                </div>
              `).join('')}

              <div class="mapping-section-label">Special Darshan & Documents:</div>
              <div class="mapping-pills">
                <button type="button" class="pill-target ${this.selectedMappingKey === 'special_category' ? 'active' : ''}" data-key="special_category">Category</button>
                <button type="button" class="pill-target ${this.selectedMappingKey === 'special_attendantRequired' ? 'active' : ''}" data-key="special_attendantRequired">Attendant Yes/No</button>
                <button type="button" class="pill-target ${this.selectedMappingKey === 'special_disabilityType' ? 'active' : ''}" data-key="special_disabilityType">Disability Type</button>
                <button type="button" class="pill-target ${this.selectedMappingKey === 'special_disabilityPercentage' ? 'active' : ''}" data-key="special_disabilityPercentage">Disability %</button>
                <button type="button" class="pill-target ${this.selectedMappingKey === 'special_medicalCondition' ? 'active' : ''}" data-key="special_medicalCondition">Medical Condition</button>
                <button type="button" class="pill-target ${this.selectedMappingKey === 'special_certificateOrUdidNumber' ? 'active' : ''}" data-key="special_certificateOrUdidNumber">UDID / Cert No</button>
                <button type="button" class="pill-target ${this.selectedMappingKey === 'doc_id_proof' ? 'active' : ''}" data-key="doc_id_proof">Aadhaar Doc Upload</button>
                <button type="button" class="pill-target ${this.selectedMappingKey === 'doc_category_cert' ? 'active' : ''}" data-key="doc_category_cert">Certificate Doc Upload</button>
              </div>

              <div class="mapping-section-label">General Details:</div>
              <div class="mapping-pills">
                <button type="button" class="pill-target ${this.selectedMappingKey === 'general_gothram' ? 'active' : ''}" data-key="general_gothram">Gothram</button>
                <button type="button" class="pill-target ${this.selectedMappingKey === 'general_email' ? 'active' : ''}" data-key="general_email">Email</button>
                <button type="button" class="pill-target ${this.selectedMappingKey === 'general_mobile' ? 'active' : ''}" data-key="general_mobile">Mobile</button>
                <button type="button" class="pill-target ${this.selectedMappingKey === 'general_city' ? 'active' : ''}" data-key="general_city">City</button>
                <button type="button" class="pill-target ${this.selectedMappingKey === 'general_state' ? 'active' : ''}" data-key="general_state">State</button>
                <button type="button" class="pill-target ${this.selectedMappingKey === 'general_pincode' ? 'active' : ''}" data-key="general_pincode">Pincode</button>
              </div>

              <div style="font-size: 11px; color: #64748b; margin: 8px 0 6px 0; line-height: 1.3;">
                👉 <strong>Step 2:</strong> Click the corresponding input or dropdown on the TTD page to link it.
              </div>
              <button class="btn-sec" id="btn-cancel-mapping" style="width: 100%;">✕ Cancel Mapping</button>
            </div>
          </div>

          <!-- Dynamic Type Assist / Quick Paste Display Card -->
          <div id="assist-tray"></div>

          <!-- Post-Fill Audit Tray -->
          <div id="audit-tray"></div>

          ${(this.activeProfile?.pilgrims[0]?.proofDocuments?.idProofDoc || this.activeProfile?.pilgrims[0]?.proofDocuments?.categoryCertificateDoc) ? `
            <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed ${isDark ? '#334155' : '#cbd5e1'};">
              <div style="font-size: 10px; font-weight: 700; color: #64748b; margin-bottom: 4px;">💾 READY &lt;1MB DOCUMENTS (CLICK TO DOWNLOAD / DRAG):</div>
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                ${this.activeProfile.pilgrims[0].proofDocuments.idProofDoc ? `
                  <button type="button" class="btn-sub btn-download-proof-doc" data-doc="idProof" title="Download ${this.activeProfile.pilgrims[0].proofDocuments.idProofDoc.fileName}">
                    📥 ${this.activeProfile.pilgrims[0].proofDocuments.idProofDoc.fileName} (${Math.round(this.activeProfile.pilgrims[0].proofDocuments.idProofDoc.sizeBytes / 1024)} KB)
                  </button>
                ` : ''}
                ${this.activeProfile.pilgrims[0].proofDocuments.categoryCertificateDoc ? `
                  <button type="button" class="btn-sub btn-download-proof-doc" data-doc="categoryCert" title="Download ${this.activeProfile.pilgrims[0].proofDocuments.categoryCertificateDoc.fileName}">
                    📥 ${this.activeProfile.pilgrims[0].proofDocuments.categoryCertificateDoc.fileName} (${Math.round(this.activeProfile.pilgrims[0].proofDocuments.categoryCertificateDoc.sizeBytes / 1024)} KB)
                  </button>
                ` : ''}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    if (!this.shadow) return;

    // Enable drag-and-drop to freely reposition the panel anywhere on the screen
    this.setupDraggable();

    // Toggle collapse on header click (only if user did NOT drag)
    this.shadow.querySelector('#panel-header')?.addEventListener('click', (e) => {
      if (this.dragMoved) return;
      const target = e.target as HTMLElement;
      if (target.closest('#btn-toggle-collapse')) return;
      this.isCollapsed = !this.isCollapsed;
      this.render();
    });

    this.shadow.querySelector('#btn-toggle-collapse')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.isCollapsed = !this.isCollapsed;
      this.render();
    });

    this.shadow.querySelector('#btn-fill-all')?.addEventListener('click', () => {
      this.clearAuditTray();
      this.onFillRequested('auto');
    });

    this.shadow.querySelector('#btn-quick-paste')?.addEventListener('click', () => {
      this.clearAuditTray();
      this.startQuickPaste();
    });

    this.shadow.querySelector('#btn-type-assist')?.addEventListener('click', () => {
      this.clearAuditTray();
      this.startTypeAssist();
    });

    this.shadow.querySelector('#btn-start-mapping')?.addEventListener('click', () => {
      this.toggleMappingMode(true);
    });

    this.shadow.querySelector('#btn-cancel-mapping')?.addEventListener('click', () => {
      this.toggleMappingMode(false);
    });

    this.shadow.querySelector('#btn-export-selectors')?.addEventListener('click', () => {
      this.onExportMappings();
    });

    this.shadow.querySelector('#btn-clear-mappings')?.addEventListener('click', () => {
      this.onClearMappings?.();
    });

    // Pill Target Selection (in-DOM, never snaps shut, 100% reliable)
    this.shadow.querySelectorAll<HTMLButtonElement>('.pill-target').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = btn.getAttribute('data-key');
        if (!key) return;

        this.selectedMappingKey = key;

        // Update active class on all pills
        this.shadow?.querySelectorAll('.pill-target').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');

        // Update target name display
        const targetNameEl = this.shadow?.querySelector('#mapping-target-name');
        if (targetNameEl && this.activeProfile) {
          targetNameEl.textContent = formatFieldKeyLabel(key, this.activeProfile.pilgrims.filter(p => p.included));
        }
      });
    });

    // Proof Document One-Click Download Handlers
    this.shadow.querySelectorAll<HTMLButtonElement>('.btn-download-proof-doc').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const docType = btn.getAttribute('data-doc');
        const doc = docType === 'idProof'
          ? this.activeProfile?.pilgrims[0]?.proofDocuments?.idProofDoc
          : this.activeProfile?.pilgrims[0]?.proofDocuments?.categoryCertificateDoc;
        if (!doc) return;
        const cleanBase64 = doc.base64Data.includes(',') ? doc.base64Data.split(',')[1] : doc.base64Data;
        const byteChars = atob(cleanBase64);
        const byteArrays = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteArrays[i] = byteChars.charCodeAt(i);
        }
        const blob = new Blob([byteArrays], { type: doc.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.fileName;
        a.click();
        URL.revokeObjectURL(url);
      });
    });
  }

  /**
   * Sets up smooth pointer dragging on the panel header.
   * Clamps within screen boundaries and remembers position across reloads.
   */
  private setupDraggable(): void {
    if (!this.shadow || !this.host) return;

    const header = this.shadow.querySelector<HTMLElement>('#panel-header');
    if (!header) return;

    let startPointerX = 0;
    let startPointerY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const onPointerDown = (e: PointerEvent) => {
      // Only drag with primary mouse button (left click)
      if (e.button !== 0) return;

      // Ignore if clicking collapse toggle button or form control
      const target = e.target as HTMLElement;
      if (target.closest('#btn-toggle-collapse')) return;

      this.isDragging = false;
      this.dragMoved = false;
      startPointerX = e.clientX;
      startPointerY = e.clientY;

      const rect = this.host!.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      try {
        header.setPointerCapture(e.pointerId);
      } catch (err) {}

      header.style.cursor = 'grabbing';
    };

    const onPointerMove = (e: PointerEvent) => {
      if (startPointerX === 0 && startPointerY === 0) return;

      const dx = e.clientX - startPointerX;
      const dy = e.clientY - startPointerY;

      // Threshold to distinguish click from intentional drag
      if (!this.dragMoved && Math.hypot(dx, dy) < 4) {
        return;
      }

      this.isDragging = true;
      this.dragMoved = true;

      const rect = this.host!.getBoundingClientRect();
      const panelWidth = rect.width || 320;
      const panelHeight = rect.height || 200;

      // Keep panel clamped safely inside viewport (10px padding from edges)
      const maxLeft = Math.max(10, window.innerWidth - panelWidth - 10);
      const maxTop = Math.max(10, window.innerHeight - panelHeight - 10);

      const newLeft = Math.min(Math.max(10, initialLeft + dx), maxLeft);
      const newTop = Math.min(Math.max(10, initialTop + dy), maxTop);

      this.customPosition = { top: Math.round(newTop), left: Math.round(newLeft) };
      this.applyPosition();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (startPointerX === 0 && startPointerY === 0) return;

      startPointerX = 0;
      startPointerY = 0;
      header.style.cursor = 'grab';

      try {
        if (header.hasPointerCapture(e.pointerId)) {
          header.releasePointerCapture(e.pointerId);
        }
      } catch (err) {}

      // Persist moved position in sessionStorage for current booking session
      if (this.dragMoved && this.customPosition) {
        try {
          sessionStorage.setItem('pilgrim_quickfill_pos', JSON.stringify(this.customPosition));
        } catch (err) {}
      }

      // Small delay before clearing dragMoved so header click event knows a drag occurred
      setTimeout(() => {
        this.isDragging = false;
        this.dragMoved = false;
      }, 50);
    };

    header.addEventListener('pointerdown', onPointerDown);
    header.addEventListener('pointermove', onPointerMove);
    header.addEventListener('pointerup', onPointerUp);
    header.addEventListener('pointercancel', onPointerUp);
  }

  private clearAuditTray(): void {
    if (!this.shadow) return;
    const tray = this.shadow.querySelector('#audit-tray');
    if (tray) tray.innerHTML = '';
  }

  private startQuickPaste(): void {
    this.clearAuditTray();
    if (this.onRescanRequested) {
      this.formState = this.onRescanRequested();
    }
    if (!this.formState || this.formState.elements.length === 0) {
      alert('No visible booking fields detected on the current page/tab.');
      return;
    }
    this.stopAllAssists();

    this.quickPasteController = new QuickPasteController(
      this.formState.elements,
      (current, shortcutText, isBlocked) => {
        if (!this.shadow) return;
        const tray = this.shadow.querySelector('#assist-tray');
        if (!tray) return;

        if (!current) {
          tray.innerHTML = '';
          return;
        }

        tray.innerHTML = `
          <div class="assist-card">
            <div>${current.label || current.fieldKey}</div>
            <div class="assist-target">${current.targetValue}</div>
            <div style="font-size: 11px; color: ${isBlocked ? '#dc2626' : '#2563eb'};">
              ${isBlocked ? '⚡ Paste-blocked field: typing automatically...' : `Press <strong>${shortcutText}</strong> or click button below:`}
            </div>
            <button id="btn-fill-step" class="btn-primary" style="margin-top:6px; font-size:12px; padding:6px 12px; width:100%;">
              ⚡ Fill This Field & Next
            </button>
            ${isBlocked ? `<button id="btn-switch-type" class="btn-sub" style="margin-top:6px;">Switch to Type Assist</button>` : ''}
          </div>
        `;
        this.shadow.querySelector('#btn-fill-step')?.addEventListener('click', () => {
          this.quickPasteController?.fillCurrentAndAdvance();
        });
        this.shadow.querySelector('#btn-switch-type')?.addEventListener('click', () => this.startTypeAssist());
      }
    );
    this.quickPasteController.start();
  }

  private startTypeAssist(): void {
    this.clearAuditTray();
    if (this.onRescanRequested) {
      this.formState = this.onRescanRequested();
    }
    if (!this.formState || this.formState.elements.length === 0) {
      alert('No visible booking fields detected on the current page/tab.');
      return;
    }
    this.stopAllAssists();

    this.typeAssistController = new TypeAssistController(
      this.formState.elements,
      (state) => {
        if (!this.shadow) return;
        const tray = this.shadow.querySelector('#assist-tray');
        if (!tray) return;

        if (!state.current) {
          tray.innerHTML = '';
          return;
        }

        tray.innerHTML = `
          <div class="assist-card">
            <div>Type: <strong>${state.current.label}</strong></div>
            <div class="assist-target ${state.hasTypo ? 'typo' : ''} ${state.isComplete ? 'done' : ''}">
              ${state.displayValue}
            </div>
            <div style="font-size: 11px; font-weight: 600; color: ${state.hasTypo ? '#dc2626' : state.isComplete ? '#16a34a' : '#2563eb'};">
              ${state.hasTypo ? '❌ Typo detected! Check keystrokes.' : state.isComplete ? '✅ Matched! Moving to next...' : `Typed ${state.typedLength}/${state.displayValue.replace(/\s/g, '').length}`}
            </div>
          </div>
        `;
      }
    );
    this.typeAssistController.start();
  }

  private toggleMappingMode(active: boolean): void {
    this.isMappingActive = active;
    this.render();

    if (active) {
      this.stopAllAssists();
      this.enableElementHoverPicker();
    } else {
      this.disableElementHoverPicker();
    }
  }

  private hoverTarget: HTMLElement | null = null;
  private boundPickerMouseOver: ((e: MouseEvent) => void) | null = null;
  private boundPickerClick: ((e: MouseEvent) => void) | null = null;

  private enableElementHoverPicker(): void {
    document.body.style.cursor = 'crosshair';

    this.boundPickerMouseOver = (e: MouseEvent) => {
      // Ignore any hover events inside our own floating widget / shadow DOM!
      if (this.host && (e.composedPath().includes(this.host) || this.host.contains(e.target as Node))) return;
      const target = e.target as HTMLElement;
      if (!target) return;

      if (this.hoverTarget && this.hoverTarget !== target) {
        this.hoverTarget.style.outline = '';
      }
      this.hoverTarget = target;
      this.hoverTarget.style.outline = '2px dashed #ef4444';
    };

    this.boundPickerClick = (e: MouseEvent) => {
      // Ignore any clicks inside our own floating widget / shadow DOM!
      if (this.host && (e.composedPath().includes(this.host) || this.host.contains(e.target as Node))) return;
      let target = e.target as HTMLElement;
      if (!target) return;

      e.preventDefault();
      e.stopPropagation();

      // Check if clicked element or any ancestor is a control/dropdown trigger
      const directOrAncestor = target.closest<HTMLElement>(
        'input, select, textarea, mat-select, [role="combobox"], [role="button"], button, [aria-haspopup], .MuiSelect-select, div[class*="select" i], div[tabindex]'
      );
      if (directOrAncestor && directOrAncestor !== document.body && directOrAncestor !== document.documentElement) {
        target = directOrAncestor;
      }

      // Allow inputs, selects, textareas, mat-selects, comboboxes, buttons, and custom div dropdown triggers
      let isControl = target instanceof HTMLInputElement ||
                      target instanceof HTMLSelectElement ||
                      target instanceof HTMLTextAreaElement ||
                      target.tagName === 'MAT-SELECT' ||
                      target.getAttribute('role') === 'combobox' ||
                      target.getAttribute('role') === 'button' ||
                      target.tagName === 'BUTTON' ||
                      target.hasAttribute('aria-haspopup') ||
                      target.classList.contains('MuiSelect-select') ||
                      target.classList.contains('ant-select-selector') ||
                      (target.matches && target.matches('div[class*="select" i]')) ||
                      target.getAttribute('tabindex') !== null;

      if (!isControl) {
        // Try finding an input or dropdown trigger inside the clicked element (e.g. clicked mat-form-field or wrapper)
        const nestedInput = target.querySelector<HTMLElement>(
          'input:not([type="hidden"]), select, textarea, mat-select, [role="combobox"], [role="button"], button, [aria-haspopup], .MuiSelect-select, div[class*="select" i], div[tabindex]'
        );
        if (nestedInput) {
          target = nestedInput;
          isControl = true;
        } else {
          // Also try checking parent element in case user clicked an icon or label
          const parentControl = target.parentElement?.querySelector<HTMLElement>(
            'input:not([type="hidden"]), select, textarea, mat-select, [role="combobox"], [role="button"], button, [aria-haspopup], .MuiSelect-select, div[class*="select" i], div[tabindex]'
          );
          if (parentControl) {
            target = parentControl;
            isControl = true;
          }
        }
      }

      if (!isControl) {
        alert('⚠️ Please click directly on an input field, dropdown, or button on the TTD page.');
        return;
      }

      const fieldKey = this.selectedMappingKey;
      const mapping = createCustomMapping(fieldKey, target);
      this.onMappingSaved(mapping);

      this.toggleMappingMode(false);
      const friendlyLabel = formatFieldKeyLabel(fieldKey, this.activeProfile?.pilgrims || []);
      alert(`✅ Successfully mapped "${friendlyLabel}"!`);
    };

    document.addEventListener('mouseover', this.boundPickerMouseOver, true);
    document.addEventListener('click', this.boundPickerClick, true);
  }

  private disableElementHoverPicker(): void {
    document.body.style.cursor = '';
    if (this.hoverTarget) {
      this.hoverTarget.style.outline = '';
      this.hoverTarget = null;
    }
    if (this.boundPickerMouseOver) {
      document.removeEventListener('mouseover', this.boundPickerMouseOver, true);
      this.boundPickerMouseOver = null;
    }
    if (this.boundPickerClick) {
      document.removeEventListener('click', this.boundPickerClick, true);
      this.boundPickerClick = null;
    }
  }

  private stopAllAssists(): void {
    this.quickPasteController?.stop();
    this.quickPasteController = null;
    this.typeAssistController?.stop();
    this.typeAssistController = null;
    this.disableElementHoverPicker();
  }

  public destroy(): void {
    this.stopAllAssists();
    if (this.istInterval) clearInterval(this.istInterval);
    if (this.errorCheckInterval) clearInterval(this.errorCheckInterval);
    this.host?.remove();
    this.host = null;
  }
}
