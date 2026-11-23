import { DetectedElement, DetectedFormState } from './field-detector';
import { formatAadhaarChunks } from '../validation/validators';

export interface AuditResultItem {
  fieldKey: string;
  label: string;
  expectedValue: string;
  actualValue: string;
  status: 'success' | 'cleared' | 'mismatch' | 'invalid_class';
  errorMessage?: string;
}

export interface AuditReport {
  timestamp: number;
  totalFields: number;
  successCount: number;
  failureCount: number;
  items: AuditResultItem[];
  hasFailures: boolean;
  captchaFocused?: boolean;
}

export type FillTier = 'tier1_auto' | 'tier2_paste' | 'tier3_type';

/**
 * Sets native value on HTMLInputElement, HTMLTextAreaElement, or handles radio groups.
 */
export function setNativeInputValue(el: HTMLElement, value: string): void {
  try {
    // 1. Handle Radio Buttons (e.g. Gender Male/Female radio group)
    if (el instanceof HTMLInputElement && el.type === 'radio') {
      const radioName = el.name;
      const target = value.trim().toLowerCase();
      let matchedRadio: HTMLInputElement | null = null;

      if (radioName) {
        const radios = Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(radioName)}"]`));
        for (const r of radios) {
          const rVal = (r.value || '').trim().toLowerCase();
          const rLabel = (r.labels?.[0]?.textContent || r.parentElement?.textContent || '').trim().toLowerCase();
          if (rVal === target || rLabel.includes(target) || (target === 'male' && rVal === 'm') || (target === 'female' && rVal === 'f')) {
            matchedRadio = r;
            break;
          }
        }
      }

      const radioToClick = matchedRadio || el;
      try { radioToClick.focus(); } catch (e) {}
      radioToClick.checked = true;
      radioToClick.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      radioToClick.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      try { radioToClick.click(); } catch (e) {}
      return;
    }

    const inputEl = el as HTMLInputElement | HTMLTextAreaElement;

    // 2. Prevent browser parse errors on numeric inputs
    if (inputEl instanceof HTMLInputElement && (inputEl.type === 'number' || inputEl.type === 'range')) {
      const numeric = value.replace(/[^0-9.]/g, '');
      if (!numeric) {
        console.warn(`[Pilgrim QuickFill] Skipped non-numeric value "${value}" on <input type="${inputEl.type}">`);
        return;
      }
      value = numeric;
    }

    // 3. Mark simulated typing data attribute for hostile forms
    inputEl.dataset.userTyped = 'true';

    // 4. Focus and select element so browser editing engine is engaged
    try {
      inputEl.focus();
      if (typeof (inputEl as any).select === 'function') {
        (inputEl as any).select();
      }
    } catch (e) {}

    // 5. Try native browser execCommand('insertText') first!
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, value);
    } catch (e) {
      inserted = false;
    }

    // 6. If execCommand didn't insert (or value doesn't match), use prototype descriptor fallback
    if (!inserted || inputEl.value !== value) {
      try {
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: value.slice(-1) || 'a', bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: value
        }));
      } catch (e) {}

      const previousValue = inputEl.value;
      const prototype = inputEl instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

      if (descriptor && descriptor.set) {
        descriptor.set.call(inputEl, value);
      } else {
        inputEl.value = value;
      }

      // CRITICAL FOR REACT & NEXT.JS (ttdevasthanams.ap.gov.in uses Next.js #__next):
      // React installs an internal _valueTracker on controlled inputs.
      // If we don't reset tracker value to previousValue before dispatching 'input',
      // React treats the event as a duplicate, ignores onChange, and wipes the field!
      const tracker = (inputEl as any)._valueTracker;
      if (tracker) {
        tracker.setValue(previousValue);
      }

      try {
        inputEl.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: value
        }));
      } catch (e) {
        inputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      }

      inputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      try {
        inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: value.slice(-1) || 'a', bubbles: true, cancelable: true }));
      } catch (e) {}
    } else {
      // execCommand succeeded! Also update React tracker if present
      const tracker = (inputEl as any)._valueTracker;
      if (tracker) {
        tracker.setValue('');
      }
      inputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    }

    // 7. Dispatch blur so Angular marks control valid/touched and clears 'required' validation errors!
    inputEl.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));

    // 8. Update Angular Material mat-form-field floating state
    const matFormField = inputEl.closest('mat-form-field, .mat-form-field, .mat-mdc-form-field');
    if (matFormField) {
      matFormField.classList.add('mat-form-field-should-float');
      matFormField.classList.remove('mat-form-field-invalid');
      const label = matFormField.querySelector('label, .mat-form-field-label, .mat-mdc-floating-label');
      if (label) label.classList.add('mat-form-field-empty', 'mat-form-field-should-float');
    }
  } catch (err) {
    console.warn('[Pilgrim QuickFill] setNativeInputValue caught error:', err);
  }
}

/**
 * Sets select dropdown value and dispatches bubbling events so SPA forms update.
 * Supports exact matching and partial matching for bilingual options (e.g. "Male / పురుషుడు").
 */
export function setNativeSelectValue(el: HTMLSelectElement, targetValue: string): boolean {
  if (!targetValue) return false;
  const cleanTarget = targetValue.trim().toLowerCase();

  let matchIndex = -1;

  // 1. Try exact match first
  for (let i = 0; i < el.options.length; i++) {
    const opt = el.options[i];
    const val = opt.value.trim().toLowerCase();
    const text = opt.text.trim().toLowerCase();
    if (val === cleanTarget || text === cleanTarget || (cleanTarget === 'aadhaar' && /aadha?r/i.test(text))) {
      matchIndex = i;
      break;
    }
  }

  // 2. Try partial match (covers bilingual options like "Male / పురుషుడు" or "Aadhaar Card")
  if (matchIndex < 0) {
    for (let i = 0; i < el.options.length; i++) {
      const opt = el.options[i];
      const val = opt.value.trim().toLowerCase();
      const text = opt.text.trim().toLowerCase();
      if (val.includes(cleanTarget) || text.includes(cleanTarget)) {
        matchIndex = i;
        break;
      }
    }
  }

  if (matchIndex >= 0) {
    try {
      el.focus();
    } catch (e) {}

    const previousValue = el.value;
    el.selectedIndex = matchIndex;
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, el.options[matchIndex].value);
    } else {
      el.value = el.options[matchIndex].value;
    }

    // React valueTracker for SELECT
    const tracker = (el as any)._valueTracker;
    if (tracker) {
      tracker.setValue(previousValue);
    }

    // Always dispatch bubbling events so SPA state updates and validation clears
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
    return true;
  }

  return false;
}

/**
 * Handles select elements, Angular Material <mat-select>, React custom dropdowns, and comboboxes.
 */
export async function setAnySelectValue(el: HTMLElement, targetValue: string): Promise<boolean> {
  if (!el || !targetValue) return false;

  if (el.tagName === 'SELECT') {
    return setNativeSelectValue(el as HTMLSelectElement, targetValue);
  }

  // React / Angular / Custom combobox
  try {
    const trigger = (el.matches('button, [role="button"], [role="combobox"], [aria-haspopup]')
      ? el
      : el.querySelector<HTMLElement>('button, [role="button"], [role="combobox"], [aria-haspopup], svg') || el);

    try { trigger.focus(); } catch (e) {}
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    trigger.click();

    await new Promise(r => setTimeout(r, 150));

    // Options can be mat-option, [role="option"], li, div[role="option"], or custom dropdown items
    const options = Array.from(document.querySelectorAll<HTMLElement>(
      'mat-option, .mat-option, .mat-mdc-option, [role="option"], li[role="option"], [role="menuitem"], .select-item, [data-radix-collection-item], ul > li, .dropdown-item, .dropdown-menu a, .dropdown-menu li, .MuiMenuItem-root, .MuiAutocomplete-option, .ant-select-item-option-content, .ant-select-item, div[class*="option" i], span[class*="option" i]'
    ));

    const cleanTarget = targetValue.trim().toLowerCase();
    const isMale = cleanTarget === 'male' || cleanTarget === 'm';
    const isFemale = cleanTarget === 'female' || cleanTarget === 'f';
    const isAadhaar = /aadha?r/i.test(cleanTarget);
    const isPassport = /passport/i.test(cleanTarget);
    const isVoter = /voter/i.test(cleanTarget);

    let matchedOpt: HTMLElement | null = null;

    for (const opt of options) {
      const text = (opt.textContent || '').trim().toLowerCase();
      if (!text) continue;

      if (isMale && (text === 'male' || text.includes('male') || text.includes('పురుషుడు') || text === 'm')) {
        matchedOpt = opt;
        break;
      }
      if (isFemale && (text === 'female' || text.includes('female') || text.includes('స్త్రీ') || text === 'f')) {
        matchedOpt = opt;
        break;
      }
      if (isAadhaar && /aadha?r/i.test(text)) {
        matchedOpt = opt;
        break;
      }
      if (isPassport && /passport/i.test(text)) {
        matchedOpt = opt;
        break;
      }
      if (isVoter && /voter/i.test(text)) {
        matchedOpt = opt;
        break;
      }
      if (text === cleanTarget || text.includes(cleanTarget) || cleanTarget.includes(text)) {
        matchedOpt = opt;
        break;
      }
    }

    if (matchedOpt) {
      try { matchedOpt.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      matchedOpt.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      matchedOpt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      matchedOpt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      matchedOpt.click();

      // Check if container has a hidden input associated with this dropdown
      const container = el.closest('.form-group, .form-item, .col, div') || el.parentElement;
      if (container) {
        const hiddenInput = container.querySelector<HTMLInputElement>('input[type="hidden"], input.MuiSelect-nativeInput');
        if (hiddenInput) {
          setNativeInputValue(hiddenInput, targetValue);
        }
      }

      await new Promise(r => setTimeout(r, 80));
      return true;
    }

    await new Promise(r => setTimeout(r, 80));
    const openOverlay = document.querySelector('.cdk-overlay-backdrop, .cdk-overlay-pane, [role="listbox"], .MuiPopover-root, .ant-select-dropdown');
    if (openOverlay) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    }

    return false;
  } catch (err) {
    console.warn('[Pilgrim QuickFill] setAnySelectValue failed on custom combobox:', err);
    return false;
  }
}

/**
 * Tier 1: One-Click SPA Autofill.
 * Fills ALL text and number inputs FIRST so Angular reactive forms register them immediately
 * without interference from dropdown overlays, then handles radios, native selects, and custom selects.
 * Finally fills dependent fields (Photo ID Number) after ID Proof dropdown selection enables them.
 */
export async function executeTier1Autofill(
  formState: DetectedFormState,
  options: {
    fillAndContinue?: boolean;
    autoFocusCaptcha?: boolean;
    onProgress?: (field: DetectedElement) => void;
  } = {}
): Promise<AuditReport> {
  const elements = formState.elements;

  // Separate Text/Number inputs, Radio buttons, Native Selects, and Custom Selects
  const initialTextInputs: DetectedElement[] = [];
  const idNumberInputs: DetectedElement[] = [];
  const radioInputs: DetectedElement[] = [];
  const nativeSelects: DetectedElement[] = [];
  const customSelects: DetectedElement[] = [];

  for (const item of elements) {
    if (!item.targetValue) continue;
    const el = item.element;

    if (el instanceof HTMLInputElement && el.type === 'radio') {
      radioInputs.push(item);
    } else if (el.tagName === 'SELECT') {
      nativeSelects.push(item);
    } else if (
      el.tagName === 'MAT-SELECT' ||
      el.getAttribute('role') === 'combobox' ||
      el.getAttribute('role') === 'button' ||
      el.tagName === 'BUTTON' ||
      el.hasAttribute('aria-haspopup') ||
      el.hasAttribute('aria-expanded') ||
      el.classList.contains('MuiSelect-select') ||
      el.classList.contains('ant-select-selector') ||
      (el.matches && el.matches('div[class*="select" i]'))
    ) {
      customSelects.push(item);
    } else if (item.fieldKey.includes('idNumber')) {
      idNumberInputs.push(item);
    } else {
      initialTextInputs.push(item);
    }
  }

  // 1. FILL ALL INITIAL TEXT & NUMBER INPUTS FIRST (Instant, zero overlays, updates Angular & React FormControls)
  for (const item of initialTextInputs) {
    setNativeInputValue(item.element, item.targetValue);
    options.onProgress?.(item);
  }

  // 2. FILL RADIOS
  for (const item of radioInputs) {
    setNativeInputValue(item.element, item.targetValue);
    options.onProgress?.(item);
  }

  // 3. FILL NATIVE SELECTS
  for (const item of nativeSelects) {
    setNativeSelectValue(item.element as HTMLSelectElement, item.targetValue);
    options.onProgress?.(item);
  }

  // 4. FILL CUSTOM SELECTS SEQUENTIALLY (Country, State, Gender, ID Proof)
  for (const item of customSelects) {
    await setAnySelectValue(item.element, item.targetValue);
    options.onProgress?.(item);
  }

  // 5. CRITICAL FOR REACT/NEXT.JS & ANGULAR SPAs:
  // Selecting "Photo ID Proof" (Aadhaar/Passport) triggers component state update to enable "Photo ID Number".
  // Wait 200ms for React state re-render to complete.
  if (idNumberInputs.length > 0) {
    await new Promise(r => setTimeout(r, 200));

    for (const item of idNumberInputs) {
      let targetInput = item.element as HTMLInputElement;

      // If the input was replaced or is still disabled in React state, re-check or ensure enabled
      if (!targetInput.isConnected || targetInput.disabled) {
        // Look for refreshed or newly enabled input in the same devotee card/container or by matching label
        const container = targetInput.closest('.form-group, .form-item, .devotee-card, .pilgrim-card, div') || targetInput.parentElement;
        if (container) {
          const fresh = container.querySelector<HTMLInputElement>('input:not([type="hidden"])');
          if (fresh && fresh !== targetInput) {
            targetInput = fresh;
          }
        }
      }

      if (targetInput.disabled) {
        targetInput.disabled = false;
      }

      setNativeInputValue(targetInput, item.targetValue);
      options.onProgress?.(item);
    }
  }

  // 6. Initial Audit at 250ms
  await new Promise(r => setTimeout(r, 250));
  let audit = runPostFillAudit(elements);

  // 7. Self-Healing Retry: If any field was cleared by an SPA reactive form, retry fill once more!
  if (audit.hasFailures) {
    for (const item of initialTextInputs.concat(idNumberInputs)) {
      const curVal = (item.element as HTMLInputElement).value;
      if (!curVal) {
        if ((item.element as HTMLInputElement).disabled) {
          (item.element as HTMLInputElement).disabled = false;
        }
        setNativeInputValue(item.element, item.targetValue);
      }
    }
    for (const item of nativeSelects) {
      const curVal = (item.element as HTMLSelectElement).value;
      if (!curVal) {
        setNativeSelectValue(item.element as HTMLSelectElement, item.targetValue);
      }
    }
    for (const item of customSelects) {
      await setAnySelectValue(item.element, item.targetValue);
    }
    await new Promise(r => setTimeout(r, 250));
    audit = runPostFillAudit(elements);
  }

  // 8. Handle CAPTCHA Focus
  let captchaFocused = false;
  if (options.autoFocusCaptcha && formState.captchaElement) {
    formState.captchaElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    formState.captchaElement.focus();
    captchaFocused = true;
  }
  audit.captchaFocused = captchaFocused;

  // 9. Handle Safe Continue Click (ONLY if enabled, zero failures, and button is safe)
  if (options.fillAndContinue && !audit.hasFailures && formState.continueButton) {
    const btnText = (formState.continueButton.textContent || '').toLowerCase();
    const isPayment = /pay|payment|checkout/.test(btnText);
    const isDisabled = (formState.continueButton as HTMLButtonElement).disabled || formState.continueButton.classList.contains('disabled');

    if (!isPayment && !isDisabled) {
      console.log('[Pilgrim QuickFill] Safe Continue button clicked.');
      formState.continueButton.click();
    }
  }

  return audit;
}

/**
 * Runs Post-Fill Audit checking element values and invalid classes.
 */
export function runPostFillAudit(elements: DetectedElement[]): AuditReport {
  const items: AuditResultItem[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (const item of elements) {
    if (!item.targetValue) continue;

    const el = item.element;
    let actualValue = '';

    if (el instanceof HTMLInputElement && el.type === 'radio') {
      const radioName = el.name;
      const checked = radioName
        ? document.querySelector<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(radioName)}"]:checked`)
        : (el.checked ? el : null);
      actualValue = checked ? (checked.value || checked.labels?.[0]?.textContent?.trim() || 'selected') : '';
    } else if (el.tagName === 'SELECT') {
      const select = el as HTMLSelectElement;
      const opt = select.options[select.selectedIndex];
      actualValue = opt ? opt.text.trim() || opt.value.trim() : '';
    } else if (el.tagName === 'MAT-SELECT' || el.getAttribute('role') === 'combobox') {
      actualValue = el.textContent?.trim() || '';
    } else {
      actualValue = (el as HTMLInputElement).value?.trim() || '';
    }

    const cleanExpected = item.targetValue.trim().toLowerCase();
    const cleanActual = actualValue.trim().toLowerCase();

    // Check invalid CSS classes
    const hasInvalidClass = el.classList.contains('is-invalid') ||
      el.classList.contains('ng-invalid') ||
      el.getAttribute('aria-invalid') === 'true';

    let status: AuditResultItem['status'] = 'success';
    let errorMessage: string | undefined;

    if (!cleanActual) {
      status = 'cleared';
      errorMessage = 'Field cleared by page script or not filled';
      failureCount++;
    } else if (el instanceof HTMLInputElement && el.type === 'radio') {
      // Radio matched if checked value or label matches
      if (cleanActual === cleanExpected || cleanActual.includes(cleanExpected) || (cleanExpected === 'male' && cleanActual === 'm') || (cleanExpected === 'female' && cleanActual === 'f')) {
        successCount++;
      } else {
        status = 'mismatch';
        errorMessage = `Selected "${actualValue}", expected "${item.targetValue}"`;
        failureCount++;
      }
    } else if (el.tagName === 'SELECT' || el.tagName === 'MAT-SELECT' || el.getAttribute('role') === 'combobox') {
      if (!cleanActual.includes(cleanExpected) && !cleanExpected.includes(cleanActual)) {
        status = 'mismatch';
        errorMessage = `Selected "${actualValue}", expected "${item.targetValue}"`;
        failureCount++;
      } else {
        successCount++;
      }
    } else {
      const isAadhaar = item.fieldKey.includes('idNumber') && cleanExpected.length === 12;
      const strippedActual = cleanActual.replace(/[\s-]/g, '');
      const matchesValue = isAadhaar ? strippedActual === cleanExpected : cleanActual === cleanExpected;

      if (!matchesValue) {
        status = 'mismatch';
        errorMessage = `Contains "${actualValue}", expected "${item.targetValue}"`;
        failureCount++;
      } else if (hasInvalidClass && !matchesValue) {
        status = 'invalid_class';
        errorMessage = 'Validation error flagged by portal';
        failureCount++;
      } else {
        successCount++;
      }
    }

    items.push({
      fieldKey: item.fieldKey,
      label: item.label || item.fieldKey,
      expectedValue: item.targetValue,
      actualValue,
      status,
      errorMessage
    });
  }

  return {
    timestamp: Date.now(),
    totalFields: items.length,
    successCount,
    failureCount,
    items,
    hasFailures: failureCount > 0
  };
}

/**
 * Controller for Tier 2: Guided Quick Paste
 */
export class QuickPasteController {
  private queue: DetectedElement[] = [];
  private currentIndex: number = 0;
  private isMac: boolean = false;
  private activeHighlight: HTMLElement | null = null;
  private onStepChange?: (current: DetectedElement | null, shortcutText: string, isBlocked: boolean) => void;
  private boundPasteListener: ((e: ClipboardEvent) => void) | null = null;
  private boundClickListener: ((e: MouseEvent) => void) | null = null;
  private boundKeyDownListener: ((e: KeyboardEvent) => void) | null = null;

  constructor(elements: DetectedElement[], onStepChange?: (current: DetectedElement | null, shortcutText: string, isBlocked: boolean) => void) {
    this.queue = elements.filter(e => !!e.targetValue);
    this.onStepChange = onStepChange;
    this.isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  }

  public getShortcutText(): string {
    return this.isMac ? 'Cmd+V' : 'Ctrl+V';
  }

  public start(): void {
    if (this.queue.length === 0) return;
    this.currentIndex = 0;
    this.listenGlobalClicks();
    this.focusCurrent();
  }

  public stop(): void {
    this.clearHighlight();
    if (this.boundPasteListener && this.queue[this.currentIndex]) {
      this.queue[this.currentIndex].element.removeEventListener('paste', this.boundPasteListener as EventListener);
    }
    if (this.boundKeyDownListener && this.queue[this.currentIndex]) {
      this.queue[this.currentIndex].element.removeEventListener('keydown', this.boundKeyDownListener as EventListener);
    }
    if (this.boundClickListener) {
      document.removeEventListener('click', this.boundClickListener, true);
    }
    this.onStepChange?.(null, this.getShortcutText(), false);
  }

  private listenGlobalClicks(): void {
    this.boundClickListener = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;
      const index = this.queue.findIndex(item => item.element === target);
      if (index >= 0 && index !== this.currentIndex) {
        this.clearHighlight();
        this.currentIndex = index;
        this.focusCurrent();
      }
    };
    document.addEventListener('click', this.boundClickListener, true);
  }

  private async focusCurrent(): Promise<void> {
    if (this.currentIndex >= this.queue.length) {
      this.stop();
      return;
    }

    const item = this.queue[this.currentIndex];
    const el = item.element;

    // Apply Glowing Outline
    this.clearHighlight();
    el.style.outline = '3px solid #f59e0b';
    el.style.boxShadow = '0 0 12px rgba(245, 158, 11, 0.7)';
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    } catch (e) {}
    this.activeHighlight = el;

    // Copy target value to clipboard
    try {
      await navigator.clipboard.writeText(item.targetValue);
    } catch (e) {
      console.warn('[QuickPaste] Clipboard write note:', e);
    }

    // 1. If dropdown / combobox / radio: auto-select and advance smoothly!
    if (el.tagName === 'SELECT' || el.tagName === 'MAT-SELECT' || el.getAttribute('role') === 'combobox') {
      setAnySelectValue(el, item.targetValue);
      this.onStepChange?.(item, `Selected "${item.targetValue}"`, false);
      setTimeout(() => {
        this.advance();
      }, 350);
      return;
    }

    if (el instanceof HTMLInputElement && el.type === 'radio') {
      setNativeInputValue(el, item.targetValue);
      this.onStepChange?.(item, `Selected "${item.targetValue}"`, false);
      setTimeout(() => {
        this.advance();
      }, 350);
      return;
    }

    // 2. Check if paste is blocked on this element
    const isPasteBlocked = el.hasAttribute('onpaste') || el.classList.contains('no-paste');

    this.onStepChange?.(item, this.getShortcutText(), isPasteBlocked);

    // Listen for Ctrl+V / Cmd+V keydown event
    this.boundKeyDownListener = (e: KeyboardEvent) => {
      const isPasteKey = (this.isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'v';
      if (isPasteKey) {
        setTimeout(() => {
          setNativeInputValue(el, item.targetValue);
          this.advance();
        }, 60);
      }
    };
    el.addEventListener('keydown', this.boundKeyDownListener as EventListener);

    // Listen for paste event
    this.boundPasteListener = (e: ClipboardEvent) => {
      setTimeout(() => {
        setNativeInputValue(el, item.targetValue);
        this.advance();
      }, 50);
    };

    el.addEventListener('paste', this.boundPasteListener as EventListener, { once: true });
  }

  public fillCurrentAndAdvance(): void {
    if (this.currentIndex >= this.queue.length) return;
    const item = this.queue[this.currentIndex];
    const el = item.element;
    if (el.tagName === 'SELECT' || el.tagName === 'MAT-SELECT' || el.getAttribute('role') === 'combobox') {
      setAnySelectValue(el, item.targetValue);
    } else {
      setNativeInputValue(el, item.targetValue);
    }
    this.advance();
  }

  public advance(): void {
    this.clearHighlight();
    if (this.boundPasteListener && this.queue[this.currentIndex]) {
      this.queue[this.currentIndex].element.removeEventListener('paste', this.boundPasteListener as EventListener);
    }
    if (this.boundKeyDownListener && this.queue[this.currentIndex]) {
      this.queue[this.currentIndex].element.removeEventListener('keydown', this.boundKeyDownListener as EventListener);
    }
    this.currentIndex++;
    this.focusCurrent();
  }

  private clearHighlight(): void {
    if (this.activeHighlight) {
      this.activeHighlight.style.outline = '';
      this.activeHighlight.style.boxShadow = '';
      this.activeHighlight = null;
    }
  }
}

/**
 * Controller for Tier 3: Paste-Blocked Type Assist
 */
export class TypeAssistController {
  private queue: DetectedElement[] = [];
  private currentIndex: number = 0;
  private activeHighlight: HTMLElement | null = null;
  private onStateChange?: (state: {
    current: DetectedElement | null;
    displayValue: string;
    isAadhaar: boolean;
    typedLength: number;
    hasTypo: boolean;
    isComplete: boolean;
  }) => void;
  private boundInputListener: ((e: Event) => void) | null = null;

  constructor(
    elements: DetectedElement[],
    onStateChange?: (state: {
      current: DetectedElement | null;
      displayValue: string;
      isAadhaar: boolean;
      typedLength: number;
      hasTypo: boolean;
      isComplete: boolean;
    }) => void
  ) {
    this.queue = elements.filter(e => !!e.targetValue);
    this.onStateChange = onStateChange;
  }

  public start(): void {
    if (this.queue.length === 0) return;
    this.currentIndex = 0;
    this.focusCurrent();
  }

  public stop(): void {
    this.clearHighlight();
    if (this.boundInputListener && this.queue[this.currentIndex]) {
      this.queue[this.currentIndex].element.removeEventListener('input', this.boundInputListener);
    }
    this.onStateChange?.({
      current: null,
      displayValue: '',
      isAadhaar: false,
      typedLength: 0,
      hasTypo: false,
      isComplete: false
    });
  }

  private focusCurrent(): void {
    if (this.currentIndex >= this.queue.length) {
      this.stop();
      return;
    }

    const item = this.queue[this.currentIndex];
    const el = item.element;

    this.clearHighlight();
    el.style.outline = '3px solid #3b82f6';
    el.style.boxShadow = '0 0 12px rgba(59, 130, 246, 0.7)';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try {
      el.focus();
    } catch (e) {}
    this.activeHighlight = el;

    // Handle dropdown in Type Assist
    if (el.tagName === 'SELECT') {
      const select = el as HTMLSelectElement;
      setNativeSelectValue(select, item.targetValue);
      this.onStateChange?.({
        current: item,
        displayValue: item.targetValue,
        isAadhaar: false,
        typedLength: item.targetValue.length,
        hasTypo: false,
        isComplete: true
      });
      setTimeout(() => this.advance(), 350);
      return;
    }

    const inputEl = el as HTMLInputElement;
    const isAadhaar = item.fieldKey.includes('idNumber') && item.targetValue.length === 12;
    const displayValue = isAadhaar ? formatAadhaarChunks(item.targetValue) : item.targetValue;

    this.onStateChange?.({
      current: item,
      displayValue,
      isAadhaar,
      typedLength: inputEl.value.length,
      hasTypo: false,
      isComplete: false
    });

    this.boundInputListener = () => {
      const typed = inputEl.value;
      const cleanTyped = isAadhaar ? typed.replace(/[\s-]/g, '') : typed;
      const target = item.targetValue;

      const hasTypo = !target.startsWith(cleanTyped);
      const isComplete = cleanTyped === target;

      this.onStateChange?.({
        current: item,
        displayValue,
        isAadhaar,
        typedLength: cleanTyped.length,
        hasTypo,
        isComplete
      });

      if (isComplete) {
        // Auto advance to next field the millisecond full string matches!
        setTimeout(() => {
          this.advance();
        }, 150);
      }
    };

    inputEl.addEventListener('input', this.boundInputListener);
  }

  public fillCurrentAndAdvance(): void {
    if (this.currentIndex >= this.queue.length) return;
    const item = this.queue[this.currentIndex];
    const el = item.element;
    if (el.tagName === 'SELECT' || el.tagName === 'MAT-SELECT' || el.getAttribute('role') === 'combobox') {
      setAnySelectValue(el, item.targetValue);
    } else {
      setNativeInputValue(el, item.targetValue);
    }
    this.advance();
  }

  public advance(): void {
    this.clearHighlight();
    if (this.boundInputListener && this.queue[this.currentIndex]) {
      this.queue[this.currentIndex].element.removeEventListener('input', this.boundInputListener);
    }
    this.currentIndex++;
    this.focusCurrent();
  }

  private clearHighlight(): void {
    if (this.activeHighlight) {
      this.activeHighlight.style.outline = '';
      this.activeHighlight.style.boxShadow = '';
      this.activeHighlight = null;
    }
  }
}
