import { DetectedElement, DetectedFormState } from './field-detector';
import { formatAadhaarChunks } from '../validation/validators';

/**
 * Reconstructs a File object from Base64 data for DataTransfer assignment to <input type="file">.
 */
export function base64ToFile(base64Data: string, fileName: string, mimeType: string): File {
  const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const byteChars = atob(cleanBase64);
  const byteArrays = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteArrays[i] = byteChars.charCodeAt(i);
  }
  const blob = new Blob([byteArrays], { type: mimeType });
  return new File([blob], fileName, { type: mimeType });
}

/**
 * Formats a Date of Birth string (YYYY-MM-DD or DD-MM-YYYY) to match the target input's requirements.
 */
export function formatDobForInput(dob: string, el: HTMLElement): string {
  if (!dob) return '';
  const clean = dob.trim();
  const isDateInput = el instanceof HTMLInputElement && el.type === 'date';
  let y = '', m = '', d = '';
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(clean)) {
    const parts = clean.split(/[-/]/);
    y = parts[0];
    m = parts[1].padStart(2, '0');
    d = parts[2].padStart(2, '0');
  } else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(clean)) {
    const parts = clean.split(/[-/]/);
    d = parts[0].padStart(2, '0');
    m = parts[1].padStart(2, '0');
    y = parts[2];
  }

  if (y && m && d) {
    if (isDateInput) return `${y}-${m}-${d}`;
    const ph = el.getAttribute('placeholder') || '';
    if (/dd[-/]mm[-/]yyyy/i.test(ph) || /dd/i.test(ph)) {
      return `${d}-${m}-${y}`;
    }
    return `${y}-${m}-${d}`;
  }
  return clean;
}

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
          const isMatch = rVal === target ||
            rLabel === target ||
            rLabel.includes(target) ||
            target.includes(rLabel) ||
            (target === 'yes' && (rVal === 'yes' || rVal === 'y' || rVal === '1' || rLabel.includes('yes'))) ||
            (target === 'no' && (rVal === 'no' || rVal === 'n' || rVal === '0' || rLabel.includes('no'))) ||
            (target === 'male' && (rVal === 'm' || rLabel.includes('male'))) ||
            (target === 'female' && (rVal === 'f' || rLabel.includes('female'))) ||
            (target.includes('differently') && (rVal.includes('differently') || rVal.includes('pwd') || rVal.includes('ph') || rLabel.includes('differently') || rLabel.includes('pwd') || rLabel.includes('ph'))) ||
            (target.includes('senior') && (rVal.includes('senior') || rVal.includes('aged') || rLabel.includes('senior') || rLabel.includes('aged'))) ||
            (target.includes('medical') && (rVal.includes('medical') || rLabel.includes('medical')));
          if (isMatch) {
            matchedRadio = r;
            break;
          }
        }
      }

      const radioToClick = matchedRadio || el;
      if (radioName) {
        const allRadios = Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(radioName)}"]`));
        allRadios.forEach(r => { if (r !== radioToClick) r.checked = false; });
      }
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
      if (inputEl.value && inputEl.value !== value) {
        const proto = inputEl instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) {
          desc.set.call(inputEl, '');
        } else {
          inputEl.value = '';
        }
      }
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
    const isMale = cleanTarget === 'male' || cleanTarget === 'm';
    const isFemale = cleanTarget === 'female' || cleanTarget === 'f';
    const isAadhaar = /aadha?r/i.test(cleanTarget);

    for (let i = 0; i < el.options.length; i++) {
      const opt = el.options[i];
      const val = opt.value.trim().toLowerCase();
      const text = opt.text.trim().toLowerCase();
      if (isMale) {
        if ((val === 'male' || (val.includes('male') && !val.includes('female')) || val === 'm') ||
            (text === 'male' || (text.includes('male') && !text.includes('female')) || text.includes('పురుషుడు'))) {
          matchIndex = i;
          break;
        }
      } else if (isFemale) {
        if (val.includes('female') || text.includes('female') || val === 'f' || text.includes('స్త్రీ')) {
          matchIndex = i;
          break;
        }
      } else if (isAadhaar && (/aadha?r/i.test(val) || /aadha?r/i.test(text))) {
        matchIndex = i;
        break;
      } else if (val.includes(cleanTarget) || text.includes(cleanTarget)) {
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
    const trigger = (el.matches('button, [role="button"], [role="combobox"], [aria-haspopup], .MuiSelect-select, div[tabindex]')
      ? el
      : el.querySelector<HTMLElement>('button, [role="button"], [role="combobox"], [aria-haspopup], .MuiSelect-select, svg, div[tabindex]') || el);

    try { trigger.focus(); } catch (e) {}
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    trigger.click();

    // Poll up to 360ms for options to mount into the DOM
    const optionSelector = 'mat-option, .mat-option, .mat-mdc-option, [role="option"], li[role="option"], [role="menuitem"], .select-item, [data-radix-collection-item], ul > li, .dropdown-item, .dropdown-menu a, .dropdown-menu li, .MuiMenuItem-root, .MuiButtonBase-root, .MuiAutocomplete-option, .ant-select-item-option-content, .ant-select-item, div[class*="option" i], span[class*="option" i], div[class*="menu" i] > div, div[role="listbox"] > *';

    let options: HTMLElement[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise(r => setTimeout(r, 60));
      options = Array.from(document.querySelectorAll<HTMLElement>(optionSelector)).filter(opt => {
        const style = window.getComputedStyle(opt);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
      if (options.length > 0) break;
    }

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

      if (isMale && (text === 'male' || (text.includes('male') && !text.includes('female')) || text.includes('పురుషుడు') || text === 'm')) {
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
      if (!isMale && !isFemale && (text === cleanTarget || text.includes(cleanTarget) || (text.length > 2 && cleanTarget.includes(text)))) {
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

      // Synchronize trigger text if it's a div or button
      if (trigger && (trigger.tagName === 'DIV' || trigger.tagName === 'BUTTON')) {
        const textNode = Array.from(trigger.childNodes).find(n => n.nodeType === Node.TEXT_NODE && (n.nodeValue || '').trim().length > 0);
        if (textNode) {
          textNode.nodeValue = matchedOpt.textContent?.trim() || targetValue;
        }
      }

      await new Promise(r => setTimeout(r, 150));
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
  const fileInputs: DetectedElement[] = [];

  for (const item of elements) {
    if (!item.targetValue) continue;
    const el = item.element;

    if (el instanceof HTMLInputElement && el.type === 'file') {
      fileInputs.push(item);
    } else if (el instanceof HTMLInputElement && el.type === 'radio') {
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
    if (item.fieldKey.includes('dob')) {
      const formatted = formatDobForInput(item.targetValue, item.element);
      setNativeInputValue(item.element, formatted);
    } else {
      setNativeInputValue(item.element, item.targetValue);
    }
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

  // 5b. FILL FILE INPUTS via DataTransfer
  for (const item of fileInputs) {
    const fileInput = item.element as HTMLInputElement;
    if (item.doc && item.doc.base64Data) {
      try {
        const file = base64ToFile(item.doc.base64Data, item.doc.fileName, item.doc.mimeType);
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (err) {
        console.warn('[Pilgrim QuickFill] Failed attaching file via DataTransfer:', err);
      }
    }
    options.onProgress?.(item);
  }

  // 6. Initial Audit at 250ms
  await new Promise(r => setTimeout(r, 250));
  let audit = runPostFillAudit(elements);

  // 7. Self-Healing Retry: If any field was cleared by an SPA reactive form, retry fill once more!
  if (audit.hasFailures) {
    const failedKeys = new Set(audit.items.filter(i => i.status !== 'success').map(i => i.fieldKey));

    for (const item of initialTextInputs.concat(idNumberInputs)) {
      if (!failedKeys.has(item.fieldKey)) continue;
      const curVal = (item.element as HTMLInputElement).value;
      if (!curVal || curVal.replace(/[\s-]/g, '') !== item.targetValue.replace(/[\s-]/g, '')) {
        if ((item.element as HTMLInputElement).disabled) {
          (item.element as HTMLInputElement).disabled = false;
        }
        setNativeInputValue(item.element, item.targetValue);
      }
    }
    for (const item of nativeSelects) {
      if (!failedKeys.has(item.fieldKey)) continue;
      const curVal = (item.element as HTMLSelectElement).value;
      if (!curVal) {
        setNativeSelectValue(item.element as HTMLSelectElement, item.targetValue);
      }
    }
    for (const item of customSelects) {
      if (!failedKeys.has(item.fieldKey)) continue;
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

    const isDropdown = el.tagName === 'SELECT' ||
      el.tagName === 'MAT-SELECT' ||
      el.getAttribute('role') === 'combobox' ||
      el.getAttribute('role') === 'button' ||
      el.classList.contains('MuiSelect-select') ||
      (el.matches && el.matches('div[class*="select" i]')) ||
      item.fieldKey.includes('idProofType') ||
      item.fieldKey.includes('gender') ||
      item.fieldKey.includes('special_category') ||
      item.fieldKey.includes('special_disabilityType') ||
      item.fieldKey.includes('special_medicalCondition');

    if (el instanceof HTMLInputElement && el.type === 'file') {
      const fileInput = el as HTMLInputElement;
      const hasFile = !!(fileInput.files && fileInput.files.length > 0);
      actualValue = hasFile ? fileInput.files![0].name : '';
      if (hasFile) {
        successCount++;
        items.push({
          fieldKey: item.fieldKey,
          label: item.label || item.fieldKey,
          expectedValue: item.targetValue,
          actualValue,
          status: 'success'
        });
      } else {
        failureCount++;
        items.push({
          fieldKey: item.fieldKey,
          label: item.label || item.fieldKey,
          expectedValue: item.targetValue,
          actualValue: '',
          status: 'cleared',
          errorMessage: 'File not attached to input'
        });
      }
      continue;
    } else if (el instanceof HTMLInputElement && el.type === 'radio') {
      const radioName = el.name;
      let checked: HTMLInputElement | null = null;
      if (radioName) {
        const radios = Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(radioName)}"]`));
        checked = radios.find(r => r.checked) || null;
      } else {
        checked = el.checked ? el : null;
      }
      actualValue = checked ? (checked.value || checked.labels?.[0]?.textContent?.trim() || 'selected') : '';
    } else if (el.tagName === 'SELECT') {
      const select = el as HTMLSelectElement;
      const opt = select.options[select.selectedIndex];
      actualValue = opt ? opt.text.trim() || opt.value.trim() : '';
    } else if (isDropdown) {
      // 1. Check associated hidden input inside parent/container (MUI Select standard)
      const container = el.closest('.form-group, .form-item, .col, div') || el.parentElement;
      const hiddenInput = container?.querySelector<HTMLInputElement>('input[type="hidden"], input.MuiSelect-nativeInput');
      const hiddenVal = hiddenInput?.value?.trim() || '';
      // 2. Check trigger text content
      const textVal = el.textContent?.trim() || '';
      // 3. Check element value if input
      const inputVal = (el as HTMLInputElement).value?.trim() || '';
      actualValue = hiddenVal || textVal || inputVal;
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
      const isRadioMatch = cleanActual === cleanExpected ||
        cleanActual.includes(cleanExpected) ||
        cleanExpected.includes(cleanActual) ||
        (cleanExpected === 'yes' && (cleanActual === 'yes' || cleanActual === 'y' || cleanActual === '1')) ||
        (cleanExpected === 'no' && (cleanActual === 'no' || cleanActual === 'n' || cleanActual === '0')) ||
        (cleanExpected === 'male' && cleanActual === 'm') ||
        (cleanExpected === 'female' && cleanActual === 'f');
      if (isRadioMatch) {
        successCount++;
      } else {
        status = 'mismatch';
        errorMessage = `Selected "${actualValue}", expected "${item.targetValue}"`;
        failureCount++;
      }
    } else if (isDropdown) {
      let isDropdownMatch = false;

      // Special check for ID Proof Types (e.g. "Aadhaar Card" vs "Aadhaar", "Passport", etc.)
      if (item.fieldKey.includes('idProofType') || /id.*(?:type|proof)/i.test(item.label || '')) {
        const isAadhaarExpected = /aadha?r/i.test(cleanExpected);
        const isAadhaarActual = /aadha?r/i.test(cleanActual);
        if (isAadhaarExpected && isAadhaarActual) {
          isDropdownMatch = true;
        } else if (/passport/i.test(cleanExpected) && /passport/i.test(cleanActual)) {
          isDropdownMatch = true;
        } else if (/voter/i.test(cleanExpected) && /voter/i.test(cleanActual)) {
          isDropdownMatch = true;
        } else if (/pan/i.test(cleanExpected) && /pan/i.test(cleanActual)) {
          isDropdownMatch = true;
        } else if (/driving|dl/i.test(cleanExpected) && /driving|dl/i.test(cleanActual)) {
          isDropdownMatch = true;
        }
      }

      // Special check for Gender (Male vs Female)
      if (item.fieldKey.includes('gender') || /gender|sex/i.test(item.label || '')) {
        const isMaleExpected = cleanExpected === 'male' || cleanExpected === 'm';
        const isFemaleExpected = cleanExpected === 'female' || cleanExpected === 'f';
        if (isMaleExpected && (cleanActual === 'male' || (cleanActual.includes('male') && !cleanActual.includes('female')) || cleanActual === 'm' || cleanActual.includes('పురుషుడు'))) {
          isDropdownMatch = true;
        } else if (isFemaleExpected && (cleanActual === 'female' || cleanActual.includes('female') || cleanActual === 'f' || cleanActual.includes('స్త్రీ'))) {
          isDropdownMatch = true;
        }
      }

      // General substring / equality fallback for other dropdowns
      if (!isDropdownMatch) {
        isDropdownMatch = cleanActual === cleanExpected ||
          cleanActual.includes(cleanExpected) ||
          cleanExpected.includes(cleanActual);
      }

      if (isDropdownMatch) {
        successCount++;
      } else {
        status = 'mismatch';
        errorMessage = `Selected "${actualValue}", expected "${item.targetValue}"`;
        failureCount++;
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
