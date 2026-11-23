import { CustomFieldMapping, Pilgrim, GeneralDetails, Profile, StoredDoc } from '../models/schema';

export interface DetectedElement {
  fieldKey: string;
  element: HTMLElement;
  targetValue: string;
  pilgrimIndex?: number;
  label?: string;
  source: 'heuristic' | 'custom_map';
  doc?: StoredDoc;
}

export interface DetectedFormState {
  pilgrimRowsCount: number;
  elements: DetectedElement[];
  captchaElement?: HTMLInputElement;
  continueButton?: HTMLElement;
}

// Regex patterns for heuristic detection
const PATTERNS = {
  name: /(?:pilgrim|devotee|passenger|visitor|person|first|full|gruhastha|grihastha)?[\s_-]*name/i,
  age: /(?:pilgrim|devotee)?[\s_-]*age/i,
  gender: /(?:gender|sex)/i,
  idType: /(?:id[\s_-]*proof|proof[\s_-]*type|photo[\s_-]*id[\s_-]*(?:proof|type)|id[\s_-]*type|identification|idcard)/i,
  idNumber: /(?:id[\s_-]*(?:no|number|card|num)|photo[\s_-]*id[\s_-]*number|aadha?r|passport|voter|pan|card[\s_-]*no|identity)/i,
  gothram: /(?:gothram|gotra|gothra)/i,
  email: /(?:e-?mail|email[\s_-]*address|emailid)/i,
  mobile: /(?:mobile|phone|contact[\s_-]*no|cell|mobileno)/i,
  city: /(?:city|town)/i,
  state: /(?:state|province)/i,
  country: /(?:country|nation)/i,
  pincode: /(?:pin[\s_-]*code|pincode|postal|zip)/i,
  captcha: /(?:captcha|security[\s_-]*code|enter[\s_-]*characters)/i,
  continueBtn: /(?:continue|next|proceed|submit|save\s*&\s*continue)/i,
  forbiddenPaymentBtn: /(?:pay|payment|pay\s*now|checkout|make\s*payment)/i,
  category: /(?:special[\s_-]*)?category|differently[\s_-]*abled|sr\.?\s*citizen|senior[\s_-]*citizen|medical(?:[\s_-]*case)?/i,
  disabilityType: /(?:disability|ph)[\s_-]*type|type[\s_-]*of[\s_-]*disability/i,
  disabilityPercentage: /(?:disability[\s_-]*)?(?:percentage|percent|%)/i,
  medicalCondition: /(?:medical[\s_-]*)?(?:condition|illness|disease|surgery)/i,
  attendantRequired: /(?:attendant|companion|escort)[\s_-]*(?:required|needed|accompanying|opt|flag|\?)/i,
  dob: /(?:date[\s_-]*of[\s_-]*birth|birth[\s_-]*date|dob)/i,
  fileUpload: /(?:upload|certificate|aadha?r[\s_-]*proof|id[\s_-]*proof|ph[\s_-]*cert|medical[\s_-]*cert|document|proof[\s_-]*file|udid)/i,
  udidNumber: /(?:udid|certificate[\s_-]*(?:no|number)|cert[\s_-]*no)/i
};

/**
 * Checks if an element is currently visible in the active document.
 */
export function isElementVisible(el: HTMLElement): boolean {
  if (!el || !el.isConnected) return false;

  // Check tab panels: if inside a tab panel, it must be the active tab panel
  const tabPanel = el.closest('.tab-panel');
  if (tabPanel && !tabPanel.classList.contains('active')) {
    return false;
  }

  // Check if element or any ancestor is hidden via inline style, hidden attribute, or aria-hidden
  let curr: HTMLElement | null = el;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    if (curr.hidden || curr.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    const style = curr.style;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) {
      return false;
    }
    curr = curr.parentElement;
  }

  const compStyle = window.getComputedStyle(el);
  if (compStyle.display === 'none' || compStyle.visibility === 'hidden' || compStyle.opacity === '0') {
    return false;
  }

  return true;
}

/**
 * Gets clean visible text associated with an input element or dropdown trigger.
 */
function getAssociatedLabel(el: HTMLElement): string {
  const texts: string[] = [];

  // 1. Direct attributes
  const aria = el.getAttribute('aria-label');
  if (aria) texts.push(aria);
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) texts.push(placeholder);
  const name = el.getAttribute('name');
  if (name) texts.push(name);
  const id = el.getAttribute('id');
  if (id) texts.push(id);
  const formControlName = el.getAttribute('formcontrolname');
  if (formControlName) texts.push(formControlName);
  const dataPlaceholder = el.getAttribute('data-placeholder');
  if (dataPlaceholder) texts.push(dataPlaceholder);
  const dataLabel = el.getAttribute('data-label');
  if (dataLabel) texts.push(dataLabel);

  // 2. Check aria-labelledby
  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const ids = ariaLabelledBy.split(/\s+/);
    for (const partId of ids) {
      const labelledEl = document.getElementById(partId);
      if (labelledEl && labelledEl.textContent) texts.push(labelledEl.textContent.trim());
    }
  }

  // 3. Check label[for="..."]
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label && label.textContent) texts.push(label.textContent.trim());
  }

  // 4. Check enclosing label
  const parentLabel = el.closest('label');
  if (parentLabel && parentLabel.textContent) {
    texts.push(parentLabel.textContent.trim());
  }

  // 5. Check enclosing Angular Material / Material-UI / Tailwind form container
  const formField = el.closest(
    'mat-form-field, .mat-form-field, .mat-mdc-form-field, .MuiFormControl-root, [class*="formcontrol" i], [class*="form-group" i], [class*="form-item" i], [class*="field" i], td, tr'
  );
  if (formField) {
    const matLabel = formField.querySelector(
      'mat-label, .mat-form-field-label, .mat-mdc-floating-label, .MuiFormLabel-root, .MuiInputLabel-root, label, .label, [class*="label" i]'
    );
    if (matLabel && matLabel.textContent) {
      texts.push(matLabel.textContent.trim());
    }
  }

  // 6. Check preceding siblings of el
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (['LABEL', 'SPAN', 'P', 'DIV', 'TH', 'MAT-LABEL'].includes(sibling.tagName) && sibling.textContent) {
      const stext = sibling.textContent.trim();
      if (stext.length > 0 && stext.length < 80) {
        texts.push(stext);
        break;
      }
    }
    sibling = sibling.previousElementSibling;
  }

  // 6b. Check preceding siblings of el's wrapper parent only if parent is a dedicated input-base wrapper
  if (
    el.parentElement &&
    el.parentElement.tagName !== 'BODY' &&
    el.parentElement.tagName !== 'FORM' &&
    (el.parentElement.matches('.MuiInput-root, .MuiInputBase-root, [class*="input-wrapper" i], [class*="select-wrapper" i], [class*="control" i]') || el.parentElement.querySelectorAll('input, select, textarea').length === 1)
  ) {
    let pSibling = el.parentElement.previousElementSibling;
    while (pSibling) {
      if (['LABEL', 'MAT-LABEL'].includes(pSibling.tagName) || pSibling.classList.contains('MuiFormLabel-root') || pSibling.classList.contains('MuiInputLabel-root')) {
        const pstext = pSibling.textContent?.trim() || '';
        if (pstext.length > 0 && pstext.length < 80) {
          texts.push(pstext);
          break;
        }
      }
      pSibling = pSibling.previousElementSibling;
    }
  }

  // 7. Check parent hierarchy for single-control wrappers or labeled containers
  let ancestor: HTMLElement | null = el.parentElement;
  let depth = 0;
  while (ancestor && depth < 3 && ancestor.tagName !== 'BODY' && ancestor.tagName !== 'FORM') {
    // Only inspect single-control wrappers so we don't grab labels belonging to sibling controls in the same row/grid
    const controlCount = ancestor.querySelectorAll('input, select, textarea, [role="button"]').length;
    if (controlCount <= 1) {
      const header = ancestor.querySelector('label, mat-label, .MuiFormLabel-root, .MuiInputLabel-root, .label, .title, [class*="label" i]');
      if (header && header.textContent) {
        const htext = header.textContent.trim();
        if (htext.length > 0 && htext.length < 80 && !texts.includes(htext)) texts.push(htext);
      }
    }
    depth++;
    ancestor = ancestor.parentElement;
  }

  // 8. If el itself has text (e.g. button or div dropdown trigger like <span>Select Gender</span>)
  if (el.textContent && el.tagName !== 'SELECT' && el.tagName !== 'INPUT') {
    const selfText = el.textContent.trim();
    if (selfText.length > 0 && selfText.length < 60) {
      texts.push(selfText);
    }
  }

  return texts.join(' ');
}

/**
 * Searches the DOM for form controls directly associated with visible labels matching a regex.
 * Bulletproof discovery for custom dropdown triggers (Gender, Photo ID Proof) and conditionally disabled inputs (Photo ID Number).
 */
export function findControlsForLabels(pattern: RegExp): HTMLElement[] {
  const controls: HTMLElement[] = [];
  const claimed = new Set<HTMLElement>();

  const candidateLabels = Array.from(document.querySelectorAll<HTMLElement>(
    'label, [class*="label" i], mat-label, .MuiFormLabel-root, .MuiInputLabel-root, .title, th, [data-placeholder], [data-label]'
  )).filter(isElementVisible);

  for (const lbl of candidateLabels) {
    const text = (lbl.innerText || lbl.textContent || '').trim();
    // Only evaluate compact label text (not paragraphs or whole forms)
    if (text.length === 0 || text.length > 60) continue;
    if (!pattern.test(text)) continue;

    let targetControl: HTMLElement | null = null;

    // A. If label has 'for' attribute
    if (lbl.tagName === 'LABEL') {
      const forId = (lbl as HTMLLabelElement).htmlFor;
      if (forId) {
        targetControl = document.getElementById(forId);
      }
    }

    // B. Search inside label's parent or ancestor container
    if (!targetControl) {
      let container: HTMLElement | null = lbl.parentElement;
      let depth = 0;
      while (container && depth < 4 && container.tagName !== 'BODY' && container.tagName !== 'FORM') {
        const found = container.querySelector<HTMLElement>(
          'input:not([type="hidden"]), select, mat-select, [role="button"], [role="combobox"], [aria-haspopup], button, div[class*="select" i], div[tabindex]'
        );
        if (found && found !== lbl && !lbl.contains(found) && isElementVisible(found)) {
          targetControl = found;
          break;
        }
        container = container.parentElement;
        depth++;
      }
    }

    // C. Check siblings of label or siblings of label wrapper
    if (!targetControl) {
      const candidateSibs: (HTMLElement | null)[] = [
        lbl.nextElementSibling as HTMLElement | null,
        lbl.parentElement?.nextElementSibling as HTMLElement | null
      ];

      for (let sib of candidateSibs) {
        while (sib) {
          if (sib.matches('input:not([type="hidden"]), select, mat-select, [role="button"], [role="combobox"], [aria-haspopup], button, div[class*="select" i], div[tabindex]')) {
            targetControl = sib;
            break;
          }
          const inner = sib.querySelector<HTMLElement>(
            'input:not([type="hidden"]), select, mat-select, [role="button"], [role="combobox"], [aria-haspopup], button, div[class*="select" i], div[tabindex]'
          );
          if (inner && isElementVisible(inner)) {
            targetControl = inner;
            break;
          }
          sib = sib.nextElementSibling as HTMLElement | null;
        }
        if (targetControl) break;
      }
    }

    if (targetControl && isElementVisible(targetControl) && !claimed.has(targetControl)) {
      controls.push(targetControl);
      claimed.add(targetControl);
    }
  }

  return controls;
}

/**
 * Calculates a unique, resilient CSS selector for an element.
 */
export function computeCssSelector(el: HTMLElement): string {
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }

  const name = el.getAttribute('name');
  if (name) {
    const selector = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  const formControlName = el.getAttribute('formcontrolname');
  if (formControlName) {
    const selector = `[formcontrolname="${CSS.escape(formControlName)}"]`;
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  const placeholder = el.getAttribute('placeholder');
  if (placeholder) {
    const selector = `${el.tagName.toLowerCase()}[placeholder="${CSS.escape(placeholder)}"]`;
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  // Path from nearest identified parent or body
  const parts: string[] = [];
  let curr: HTMLElement | null = el;
  while (curr && curr.tagName !== 'BODY' && curr.tagName !== 'HTML') {
    let part = curr.tagName.toLowerCase();
    if (curr.id) {
      part += `#${CSS.escape(curr.id)}`;
      parts.unshift(part);
      break;
    }
    const parent: HTMLElement | null = curr.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === curr!.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(curr) + 1;
        part += `:nth-of-type(${index})`;
      }
    }
    parts.unshift(part);
    curr = curr.parentElement;
  }
  return parts.join(' > ');
}

/**
 * Heuristically identifies repeating pilgrim rows / form cards that are currently VISIBLE.
 */
function findPilgrimRowContainers(): HTMLElement[] {
  // 1. Search for card/row containers that enclose pilgrim details and are VISIBLE
  const explicitCandidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.pilgrim-row, .devotee-card, .passenger-row, .pilgrim-card, [data-pilgrim-index], tr.pilgrim-data, .booking-row, .devotee-details, .pilgrim-details, mat-card, .mat-card, app-pilgrim, app-devotee'
    )
  ).filter(isElementVisible);

  if (explicitCandidates.length > 0) return explicitCandidates;

  // 2. Identify by finding each visible Name input (each pilgrim must have a name input!)
  const allInputs = Array.from(document.querySelectorAll<HTMLElement>('input, select, mat-select')).filter(isElementVisible);
  const nameInputs: HTMLElement[] = [];

  for (const input of allInputs) {
    if (input.tagName === 'INPUT' && (input as HTMLInputElement).type !== 'hidden') {
      const label = getAssociatedLabel(input);
      if (PATTERNS.name.test(label) && !PATTERNS.idType.test(label) && !PATTERNS.idNumber.test(label)) {
        nameInputs.push(input);
      }
    }
  }

  if (nameInputs.length > 0) {
    const containers: HTMLElement[] = [];
    for (const nameInput of nameInputs) {
      let curr = nameInput.parentElement;
      let matchedContainer: HTMLElement | null = null;
      while (curr && curr.tagName !== 'BODY' && curr.tagName !== 'FORM') {
        const otherInputs = curr.querySelectorAll('input, select, mat-select');
        if (otherInputs.length >= 2) {
          matchedContainer = curr;
          break;
        }
        curr = curr.parentElement;
      }
      containers.push(matchedContainer || nameInput.parentElement || nameInput);
    }
    return containers;
  }

  // 3. Fallback cluster scan
  const clusterContainers = new Set<HTMLElement>();
  for (const input of allInputs) {
    const labelText = getAssociatedLabel(input);
    if (PATTERNS.name.test(labelText) || PATTERNS.idNumber.test(labelText)) {
      const container = input.closest('fieldset, .form-group-row, tr, .row, .card, .panel, .form-row, div') as HTMLElement;
      if (container && isElementVisible(container)) {
        clusterContainers.add(container);
      }
    }
  }

  return Array.from(clusterContainers);
}

/**
 * Scans active DOM for TTD form fields using custom mappings + resilient heuristics.
 */
export function scanForm(
  pilgrims: Pilgrim[],
  general: GeneralDetails,
  customMappings: CustomFieldMapping[] = [],
  profile?: Profile
): DetectedFormState {
  const detected: DetectedElement[] = [];
  const claimedElements = new Set<HTMLElement>();
  const currentDomainPath = `${window.location.hostname}${window.location.pathname}`;

  // Filter to included pilgrims only
  const activePilgrims = pilgrims.filter(p => p.included);
  const primaryPilgrim = activePilgrims[0];

  // 1. First Priority: Check Custom Field Mappings for this domain
  const claimedCustomKeys = new Set<string>();

  for (const mapping of customMappings) {
    if (mapping.domainPath && !currentDomainPath.includes(mapping.domainPath.replace(/^https?:\/\//, ''))) {
      continue;
    }
    try {
      const el = document.querySelector<HTMLElement>(mapping.selector);
      if (!el || !isElementVisible(el) || claimedElements.has(el)) continue;

      let resolvedEl: HTMLElement = el;
      const isDirectControl = el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement ||
        el.tagName === 'MAT-SELECT' ||
        el.getAttribute('role') === 'combobox' ||
        el.getAttribute('role') === 'button' ||
        el.tagName === 'BUTTON' ||
        el.hasAttribute('aria-haspopup') ||
        el.classList.contains('MuiSelect-select') ||
        (el.matches && el.matches('div[class*="select" i]')) ||
        el.getAttribute('tabindex') !== null;

      if (!isDirectControl) {
        // el may be a container, form-group, or wrapper DIV: look inside for the real control
        const inner = el.querySelector<HTMLElement>(
          'input:not([type="hidden"]), select, textarea, mat-select, [role="button"], [role="combobox"], [aria-haspopup], button, .MuiSelect-select, div[class*="select" i], div[tabindex]'
        );
        if (inner && isElementVisible(inner)) {
          resolvedEl = inner;
        } else {
          console.debug('[FieldDetector] Skipping custom mapping on non-input element:', el.tagName, mapping.selector);
          continue;
        }
      }

      // Avoid claiming the same field key multiple times from custom mappings on the same page
      if (claimedCustomKeys.has(mapping.fieldKey)) {
        console.debug('[FieldDetector] Skipping duplicate custom mapping for fieldKey:', mapping.fieldKey);
        continue;
      }

      // Guard against mismatched custom mappings (e.g. mapping Gothram input to fullName or Gender to number input)
      const inputName = (resolvedEl.getAttribute('name') || '').toLowerCase();
      if (mapping.fieldKey.includes('fullName') && /gothram/i.test(inputName)) {
        console.debug('[FieldDetector] Skipping erroneous mapping of Gothram input to fullName:', mapping.selector);
        continue;
      }
      if (mapping.fieldKey.includes('gender') && resolvedEl instanceof HTMLInputElement && resolvedEl.type === 'number') {
        console.debug('[FieldDetector] Skipping invalid custom mapping of gender to numeric input:', mapping.selector);
        continue;
      }

      let targetValue = '';
      let doc: StoredDoc | undefined;
      const matchPilgrim = mapping.fieldKey.match(/^pilgrim_(\d+)_(.+)$/);
      let pilgrimIndex: number | undefined;

      if (matchPilgrim) {
        pilgrimIndex = parseInt(matchPilgrim[1], 10);
        const field = matchPilgrim[2] as keyof Pilgrim;
        if (activePilgrims[pilgrimIndex] && activePilgrims[pilgrimIndex][field] !== undefined) {
          targetValue = String(activePilgrims[pilgrimIndex][field] || '');
        }
      } else if (mapping.fieldKey.startsWith('general_')) {
        const field = mapping.fieldKey.replace('general_', '') as keyof GeneralDetails;
        if (general[field] !== undefined) {
          targetValue = String(general[field] || '');
        }
      } else if (mapping.fieldKey === 'special_category') {
        targetValue = primaryPilgrim?.specialCategory || 'Differently Abled';
      } else if (mapping.fieldKey === 'special_disabilityType') {
        targetValue = primaryPilgrim?.disabilityType || 'Orthopedic / Locomotor';
      } else if (mapping.fieldKey === 'special_disabilityPercentage') {
        targetValue = primaryPilgrim?.disabilityPercentage ? String(primaryPilgrim.disabilityPercentage) : '';
      } else if (mapping.fieldKey === 'special_medicalCondition') {
        targetValue = primaryPilgrim?.medicalCondition || 'Other';
      } else if (mapping.fieldKey === 'special_certificateOrUdidNumber') {
        targetValue = primaryPilgrim?.certificateOrUdidNumber || '';
      } else if (mapping.fieldKey === 'special_attendantRequired') {
        targetValue = profile?.attendantConfig?.requiresAttendant ? 'Yes' : 'No';
      } else if (mapping.fieldKey === 'doc_id_proof') {
        doc = primaryPilgrim?.proofDocuments?.idProofDoc;
        targetValue = doc?.fileName || 'aadhaar_doc.pdf';
      } else if (mapping.fieldKey === 'doc_category_cert') {
        doc = primaryPilgrim?.proofDocuments?.categoryCertificateDoc;
        targetValue = doc?.fileName || 'certificate_doc.pdf';
      }

      detected.push({
        fieldKey: mapping.fieldKey,
        element: resolvedEl,
        targetValue,
        pilgrimIndex,
        label: mapping.meta.placeholder || mapping.meta.nearbyText || mapping.fieldKey,
        source: 'custom_map',
        doc
      });
      claimedElements.add(resolvedEl);
      claimedCustomKeys.add(mapping.fieldKey);
    } catch (err) {
      console.debug('[FieldDetector] Failed querying custom selector:', mapping.selector, err);
    }
  }

  // 2. Identify & Claim General Contact Fields First (Email, Mobile, State, City, Country, Pincode, CAPTCHA)
  const CONTROL_SELECTORS = [
    'input',
    'select',
    'textarea',
    'mat-select',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="radiogroup"]',
    'button[aria-haspopup]',
    'button[aria-expanded]',
    'button[role="combobox"]',
    'button[class*="select" i]',
    'button[class*="dropdown" i]',
    '[role="button"][aria-haspopup]',
    '[role="button"][aria-expanded]',
    '[role="button"][class*="select" i]',
    '[role="button"][class*="dropdown" i]',
    '[aria-haspopup="listbox"]',
    '[aria-haspopup="true"]',
    '.MuiSelect-select',
    '.MuiSelect-root',
    '.ant-select-selector',
    '[data-radix-dropdown-trigger]',
    'div[tabindex="0"][role="button"]',
    'div[class*="select-trigger" i]',
    'div[class*="select_trigger" i]',
    'div[class*="custom-select" i]',
    'div[class*="select" i][role="button"]',
    'div[class*="dropdown" i][role="button"]'
  ].join(', ');

  const allVisibleControls = Array.from(
    document.querySelectorAll<HTMLElement>(CONTROL_SELECTORS)
  ).filter(isElementVisible);

  let captchaElement: HTMLInputElement | undefined;
  const fileUploadsAadhaar: HTMLElement[] = [];
  const fileUploadsCert: HTMLElement[] = [];
  const fileUploadsGeneral: HTMLElement[] = [];

  for (const el of allVisibleControls) {
    if (claimedElements.has(el)) continue;
    if (el instanceof HTMLInputElement && (el.type === 'hidden' || el.disabled)) continue;
    if (el instanceof HTMLSelectElement && el.disabled) continue;

    const labelText = getAssociatedLabel(el);

    // 0. File Inputs (<input type="file">) - prioritize immediately so file inputs are never claimed as text/idNumber/category fields!
    if (el instanceof HTMLInputElement && el.type === 'file') {
      if (/aadha?r|id[\s_-]*proof|photo[\s_-]*id|identity/i.test(labelText)) {
        fileUploadsAadhaar.push(el);
      } else if (/cert|disability|medical|hospital|discharge|udid/i.test(labelText)) {
        fileUploadsCert.push(el);
      } else {
        fileUploadsGeneral.push(el);
      }
      claimedElements.add(el);
      continue;
    }

    if (PATTERNS.captcha.test(labelText) || /captcha/i.test(el.id || '') || /captcha/i.test((el as HTMLInputElement).name || '')) {
      if (el instanceof HTMLInputElement && !captchaElement) {
        captchaElement = el;
        claimedElements.add(el);
      }
    } else if (PATTERNS.email.test(labelText) && !detected.some(d => d.fieldKey === 'general_email')) {
      detected.push({
        fieldKey: 'general_email',
        element: el,
        targetValue: general.email,
        label: 'Email',
        source: 'heuristic'
      });
      claimedElements.add(el);
    } else if (PATTERNS.gothram.test(labelText) && !detected.some(d => d.fieldKey === 'general_gothram')) {
      detected.push({
        fieldKey: 'general_gothram',
        element: el,
        targetValue: general.gothram || activePilgrims[0]?.gothram || 'Kasyapa',
        label: 'Gothram',
        source: 'heuristic'
      });
      claimedElements.add(el);
    } else if (PATTERNS.mobile.test(labelText) && !detected.some(d => d.fieldKey === 'general_mobile')) {
      detected.push({
        fieldKey: 'general_mobile',
        element: el,
        targetValue: general.mobile,
        label: 'Mobile',
        source: 'heuristic'
      });
      claimedElements.add(el);
    } else if (PATTERNS.country.test(labelText) && !detected.some(d => d.fieldKey === 'general_country')) {
      detected.push({
        fieldKey: 'general_country',
        element: el,
        targetValue: general.country || 'India',
        label: 'Country',
        source: 'heuristic'
      });
      claimedElements.add(el);
    } else if (PATTERNS.state.test(labelText) && !detected.some(d => d.fieldKey === 'general_state')) {
      detected.push({
        fieldKey: 'general_state',
        element: el,
        targetValue: general.state,
        label: 'State',
        source: 'heuristic'
      });
      claimedElements.add(el);
    } else if (PATTERNS.city.test(labelText) && !detected.some(d => d.fieldKey === 'general_city')) {
      detected.push({
        fieldKey: 'general_city',
        element: el,
        targetValue: general.city,
        label: 'City',
        source: 'heuristic'
      });
      claimedElements.add(el);
    } else if (PATTERNS.pincode.test(labelText) && !detected.some(d => d.fieldKey === 'general_pincode')) {
      detected.push({
        fieldKey: 'general_pincode',
        element: el,
        targetValue: general.pincode,
        label: 'Pincode',
        source: 'heuristic'
      });
      claimedElements.add(el);
    } else if (PATTERNS.category.test(labelText) && !detected.some(d => d.fieldKey === 'special_category')) {
      if (el instanceof HTMLInputElement && el.type === 'radio') {
        const radioName = el.name;
        if (radioName) {
          const allRadios = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(radioName)}"]`);
          allRadios.forEach(r => claimedElements.add(r as HTMLElement));
        }
      }
      detected.push({
        fieldKey: 'special_category',
        element: el,
        targetValue: primaryPilgrim?.specialCategory || 'Differently Abled',
        label: 'Category',
        source: 'heuristic'
      });
      claimedElements.add(el);
    } else if (
      PATTERNS.attendantRequired.test(labelText) &&
      !PATTERNS.name.test(labelText) &&
      (el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) || el.getAttribute('role') === 'switch' || el.getAttribute('role') === 'checkbox') &&
      !detected.some(d => d.fieldKey === 'special_attendantRequired')
    ) {
      if (el instanceof HTMLInputElement && el.type === 'radio') {
        const radioName = el.name;
        if (radioName) {
          const allRadios = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(radioName)}"]`);
          allRadios.forEach(r => claimedElements.add(r as HTMLElement));
        }
      }
      detected.push({
        fieldKey: 'special_attendantRequired',
        element: el,
        targetValue: profile?.attendantConfig?.requiresAttendant ? 'Yes' : 'No',
        label: 'Attendant Required',
        source: 'heuristic'
      });
      claimedElements.add(el);
    } else if (PATTERNS.disabilityType.test(labelText) && !detected.some(d => d.fieldKey === 'special_disabilityType')) {
      detected.push({
        fieldKey: 'special_disabilityType',
        element: el,
        targetValue: primaryPilgrim?.disabilityType || 'Orthopedic / Locomotor',
        label: 'Disability Type',
        source: 'heuristic'
      });
      claimedElements.add(el);
    } else if (PATTERNS.disabilityPercentage.test(labelText) && !detected.some(d => d.fieldKey === 'special_disabilityPercentage')) {
      detected.push({
        fieldKey: 'special_disabilityPercentage',
        element: el,
        targetValue: primaryPilgrim?.disabilityPercentage !== undefined ? String(primaryPilgrim.disabilityPercentage) : '',
        label: 'Disability Percentage',
        source: 'heuristic'
      });
      claimedElements.add(el);
    } else if (PATTERNS.medicalCondition.test(labelText) && !detected.some(d => d.fieldKey === 'special_medicalCondition')) {
      detected.push({
        fieldKey: 'special_medicalCondition',
        element: el,
        targetValue: primaryPilgrim?.medicalCondition || 'Other',
        label: 'Medical Condition',
        source: 'heuristic'
      });
      claimedElements.add(el);
    } else if (PATTERNS.udidNumber.test(labelText) && !detected.some(d => d.fieldKey === 'special_certificateOrUdidNumber')) {
      detected.push({
        fieldKey: 'special_certificateOrUdidNumber',
        element: el,
        targetValue: primaryPilgrim?.certificateOrUdidNumber || '',
        label: 'Certificate / UDID Number',
        source: 'heuristic'
      });
      claimedElements.add(el);
    }
  }

  // 3. Scan Remaining Elements for Pilgrim Rows / Fields
  // Collect candidate controls across active form in document order
  const nameInputs: HTMLElement[] = [];
  const ageInputs: HTMLElement[] = [];
  const genderControls: HTMLElement[] = [];
  const idTypeControls: HTMLElement[] = [];
  const idNumberInputs: HTMLElement[] = [];
  const gothramInputs: HTMLElement[] = [];
  const dobInputs: HTMLElement[] = [];

  const claimedRadioNames = new Set<string>();

  for (const el of allVisibleControls) {
    if (claimedElements.has(el)) continue;

    // If el is a container DIV or wrapper that contains an input or select, skip the container so the actual input/select is processed directly
    if (el.tagName === 'DIV' && el.querySelector('input:not([type="hidden"]), select, textarea')) {
      continue;
    }

    // For inputs: keep conditionally disabled inputs if they match Photo ID Number (enabled upon ID Proof selection)
    if (el instanceof HTMLInputElement) {
      if (el.type === 'hidden') continue;
      if (el.disabled) {
        const labelText = getAssociatedLabel(el);
        if (!PATTERNS.idNumber.test(labelText)) {
          continue;
        }
      }
    }
    if (el instanceof HTMLSelectElement && el.disabled) continue;

    // For buttons or non-input controls: skip action buttons (Continue, Pay, Edit, Log Out, etc.)
    if (el.tagName === 'BUTTON' || (el.getAttribute('role') === 'button' && !el.getAttribute('aria-haspopup'))) {
      const btnText = (el.textContent || '').trim();
      if (PATTERNS.continueBtn.test(btnText) || PATTERNS.forbiddenPaymentBtn.test(btnText) || /edit|log\s*out|cancel|back/i.test(btnText)) {
        continue;
      }
    }

    const labelText = getAssociatedLabel(el);
    const isNumberInput = el instanceof HTMLInputElement && el.type === 'number';
    const isRadioInput = el instanceof HTMLInputElement && el.type === 'radio';

    // 1. ID Number (Check ID Number FIRST before Age so numeric ID fields aren't claimed as Age!)
    if (!isRadioInput && PATTERNS.idNumber.test(labelText) && el.tagName !== 'SELECT' && el.getAttribute('role') !== 'combobox') {
      idNumberInputs.push(el);
      claimedElements.add(el);
    }
    // 2. Age (Check Age explicitly, only fall back to number input if NOT idNumber!)
    else if (PATTERNS.age.test(labelText) || (isNumberInput && !PATTERNS.pincode.test(labelText) && !PATTERNS.mobile.test(labelText) && !PATTERNS.idNumber.test(labelText))) {
      ageInputs.push(el);
      claimedElements.add(el);
    }
    // 3. Gender (select, mat-select, radio, combobox, or custom dropdown trigger button/div)
    else if (!isNumberInput && (
      PATTERNS.gender.test(labelText) ||
      (el.tagName === 'SELECT' && /male|female/i.test(el.innerHTML)) ||
      (el.tagName === 'MAT-SELECT' && /gender/i.test(labelText)) ||
      (isRadioInput && /gender|sex/i.test((el as HTMLInputElement).name + ' ' + labelText)) ||
      ((el.getAttribute('role') === 'button' || el.classList.contains('MuiSelect-select') || (el.matches && el.matches('div[class*="select" i]')) || el.getAttribute('tabindex') !== null) && PATTERNS.gender.test(labelText))
    )) {
      if (isRadioInput) {
        const radioName = (el as HTMLInputElement).name;
        if (radioName && claimedRadioNames.has(radioName)) {
          claimedElements.add(el);
          continue;
        }
        if (radioName) claimedRadioNames.add(radioName);
      }
      genderControls.push(el);
      claimedElements.add(el);
    }
    // 4. ID Proof Type (usually SELECT, MAT-SELECT, combobox, or custom dropdown trigger)
    else if (!isNumberInput && (
      PATTERNS.idType.test(labelText) ||
      (el.tagName === 'SELECT' && /aadha?r|passport/i.test(el.innerHTML)) ||
      (el.tagName === 'MAT-SELECT' && /id|proof/i.test(labelText)) ||
      ((el.getAttribute('role') === 'button' || el.classList.contains('MuiSelect-select') || (el.matches && el.matches('div[class*="select" i]')) || el.getAttribute('tabindex') !== null) && PATTERNS.idType.test(labelText))
    )) {
      idTypeControls.push(el);
      claimedElements.add(el);
    }
    // 5. Date of Birth (check before Name so date inputs aren't mistakenly claimed as name)
    else if (PATTERNS.dob.test(labelText) || (el instanceof HTMLInputElement && el.type === 'date')) {
      dobInputs.push(el);
      claimedElements.add(el);
    }
    // 6. Name
    else if (PATTERNS.name.test(labelText) && !PATTERNS.dob.test(labelText) && (el as HTMLInputElement).type !== 'date') {
      nameInputs.push(el);
      claimedElements.add(el);
    }
    // 7. Gothram
    else if (PATTERNS.gothram.test(labelText)) {
      gothramInputs.push(el);
      claimedElements.add(el);
    }
  }

  // 3b. Label-Guided Discovery Fallback:
  // If custom React dropdown triggers or conditionally disabled inputs were not caught by allVisibleControls,
  // locate them directly via their associated visible labels in document order!
  if (genderControls.length < activePilgrims.length) {
    const labelGenderControls = findControlsForLabels(PATTERNS.gender);
    for (const ctrl of labelGenderControls) {
      if (!claimedElements.has(ctrl) && !genderControls.includes(ctrl)) {
        genderControls.push(ctrl);
        claimedElements.add(ctrl);
      }
    }
  }

  if (idTypeControls.length < activePilgrims.length) {
    const labelIdTypeControls = findControlsForLabels(PATTERNS.idType);
    for (const ctrl of labelIdTypeControls) {
      if (!claimedElements.has(ctrl) && !idTypeControls.includes(ctrl)) {
        idTypeControls.push(ctrl);
        claimedElements.add(ctrl);
      }
    }
  }

  if (idNumberInputs.length < activePilgrims.length) {
    const labelIdNumberControls = findControlsForLabels(PATTERNS.idNumber);
    for (const ctrl of labelIdNumberControls) {
      if (!claimedElements.has(ctrl) && !idNumberInputs.includes(ctrl)) {
        idNumberInputs.push(ctrl);
        claimedElements.add(ctrl);
      }
    }
  }

  // 4. Pair Pilgrim Fields Positionally (Index i corresponds to Pilgrim i)
  const pilgrimRowsCount = Math.max(
    nameInputs.length,
    ageInputs.length,
    genderControls.length,
    idTypeControls.length,
    idNumberInputs.length
  );

  for (let i = 0; i < activePilgrims.length; i++) {
    const pilgrim = activePilgrims[i];

    if (nameInputs[i]) {
      detected.push({
        fieldKey: `pilgrim_${i}_fullName`,
        element: nameInputs[i],
        targetValue: pilgrim.fullName,
        pilgrimIndex: i,
        label: `Pilgrim ${i + 1} Name`,
        source: 'heuristic'
      });
    }

    if (ageInputs[i]) {
      detected.push({
        fieldKey: `pilgrim_${i}_age`,
        element: ageInputs[i],
        targetValue: pilgrim.age !== '' ? String(pilgrim.age) : '',
        pilgrimIndex: i,
        label: `Pilgrim ${i + 1} Age`,
        source: 'heuristic'
      });
    }

    if (genderControls[i]) {
      detected.push({
        fieldKey: `pilgrim_${i}_gender`,
        element: genderControls[i],
        targetValue: pilgrim.gender,
        pilgrimIndex: i,
        label: `Pilgrim ${i + 1} Gender`,
        source: 'heuristic'
      });
    }

    if (idTypeControls[i]) {
      detected.push({
        fieldKey: `pilgrim_${i}_idProofType`,
        element: idTypeControls[i],
        targetValue: pilgrim.idProofType,
        pilgrimIndex: i,
        label: `Pilgrim ${i + 1} ID Type`,
        source: 'heuristic'
      });
    }

    if (idNumberInputs[i]) {
      detected.push({
        fieldKey: `pilgrim_${i}_idNumber`,
        element: idNumberInputs[i],
        targetValue: pilgrim.idNumber.replace(/[\s-]/g, ''),
        pilgrimIndex: i,
        label: `Pilgrim ${i + 1} ID Number`,
        source: 'heuristic'
      });
    }

    if (gothramInputs[i]) {
      detected.push({
        fieldKey: `pilgrim_${i}_gothram`,
        element: gothramInputs[i],
        targetValue: pilgrim.gothram || '',
        pilgrimIndex: i,
        label: `Pilgrim ${i + 1} Gothram`,
        source: 'heuristic'
      });
    }

    if (dobInputs[i]) {
      detected.push({
        fieldKey: `pilgrim_${i}_dob`,
        element: dobInputs[i],
        targetValue: pilgrim.dob || '',
        pilgrimIndex: i,
        label: `Pilgrim ${i + 1} DOB`,
        source: 'heuristic'
      });
    }
  }

  // 4b. Attach File Upload Controls
  const aadhaarUploadEl = fileUploadsAadhaar[0] || fileUploadsGeneral[0];
  const certUploadEl = fileUploadsCert[0] || (fileUploadsAadhaar.length > 0 ? fileUploadsGeneral[0] : fileUploadsGeneral[1]);

  if (aadhaarUploadEl && !detected.some(d => d.fieldKey === 'doc_id_proof')) {
    const doc = primaryPilgrim?.proofDocuments?.idProofDoc;
    detected.push({
      fieldKey: 'doc_id_proof',
      element: aadhaarUploadEl,
      targetValue: doc?.fileName || 'aadhaar_doc.pdf',
      label: 'ID Proof Document (<1MB)',
      source: 'heuristic',
      doc
    });
  }

  if (certUploadEl && !detected.some(d => d.fieldKey === 'doc_category_cert')) {
    const doc = primaryPilgrim?.proofDocuments?.categoryCertificateDoc;
    detected.push({
      fieldKey: 'doc_category_cert',
      element: certUploadEl,
      targetValue: doc?.fileName || 'certificate_doc.pdf',
      label: 'Category Certificate Document (<1MB)',
      source: 'heuristic',
      doc
    });
  }

  // 5. Find Visible Safe Continue Button (NOT Payment!)
  let continueButton: HTMLElement | undefined;
  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>('button, input[type="submit"], input[type="button"], a.btn')
  ).filter(isElementVisible);

  for (const btn of buttons) {
    const text = (btn.textContent || (btn as HTMLInputElement).value || '').trim();
    if (PATTERNS.forbiddenPaymentBtn.test(text)) {
      // Payment button - NEVER click!
      continue;
    }
    if (PATTERNS.continueBtn.test(text)) {
      continueButton = btn;
      break;
    }
  }

  return {
    pilgrimRowsCount,
    elements: detected,
    captchaElement,
    continueButton
  };
}

/**
 * Creates a PII-free custom mapping object from a user selection.
 */
export function createCustomMapping(
  fieldKey: string,
  el: HTMLElement
): CustomFieldMapping {
  return {
    id: `map_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    domainPath: `${window.location.hostname}${window.location.pathname}`,
    fieldKey,
    selector: computeCssSelector(el),
    meta: {
      tagName: el.tagName,
      id: el.id || undefined,
      name: el.getAttribute('name') || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      nearbyText: getAssociatedLabel(el).substring(0, 100)
    },
    createdAt: Date.now()
  };
}
