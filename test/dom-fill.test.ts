// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { scanForm } from '../src/content/field-detector';
import { executeTier1Autofill, setNativeInputValue, setNativeSelectValue } from '../src/content/fill-engine';
import { createDefaultProfile, createDefaultPilgrim } from '../src/models/schema';

describe('DOM Field Detection & Autofill Integration', () => {
  let profile = createDefaultProfile('Family');

  beforeEach(() => {
    const html = fs.readFileSync(path.resolve('test/ttd-mock-portal.html'), 'utf8');
    document.documentElement.innerHTML = html;

    // Simulate script in mock portal that renders slots for Tab 1
    const sedContainer = document.getElementById('sed-pilgrim-rows');
    if (sedContainer) {
      sedContainer.innerHTML = '';
      for (let i = 0; i < 2; i++) {
        const row = document.createElement('div');
        row.className = 'pilgrim-card pilgrim-row';
        row.setAttribute('data-pilgrim-index', String(i));
        row.innerHTML = `
          <h4>Pilgrim ${i + 1}</h4>
          <div class="form-grid">
            <div class="form-group">
              <label for="sed-name-${i}">Pilgrim Name *</label>
              <input type="text" id="sed-name-${i}" name="pilgrim_${i}_name" placeholder="Full name on ID" class="sed-controlled">
            </div>
            <div class="form-group">
              <label for="sed-age-${i}">Age * (Paste Blocked)</label>
              <input type="number" id="sed-age-${i}" name="pilgrim_${i}_age" placeholder="Age" min="0" max="120" class="sed-controlled paste-blocked-age">
            </div>
            <div class="form-group">
              <label for="sed-gender-${i}">Gender *</label>
              <select id="sed-gender-${i}" name="pilgrim_${i}_gender" class="sed-controlled">
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>
            <div class="form-group">
              <label for="sed-id-type-${i}">Photo ID Type *</label>
              <select id="sed-id-type-${i}" name="pilgrim_${i}_id_type" class="sed-controlled">
                <option value="Aadhaar">Aadhaar</option>
                <option value="Passport">Passport</option>
              </select>
            </div>
            <div class="form-group">
              <label for="sed-id-num-${i}">ID Card Number *</label>
              <input type="text" id="sed-id-num-${i}" name="pilgrim_${i}_id_num" placeholder="ID Number" class="sed-controlled">
            </div>
          </div>
        `;
        sedContainer.appendChild(row);
      }
    }
  });

  it('should detect fields and fill pilgrim details', async () => {
    const formState = scanForm(profile.pilgrims, profile.general, []);
    console.log('Detected elements count:', formState.elements.length);
    console.log('Detected field keys:', formState.elements.map(e => `${e.fieldKey} => target: ${e.targetValue}`));

    expect(formState.elements.length).toBeGreaterThan(0);

    const audit = await executeTier1Autofill(formState, { fillAndContinue: false, autoFocusCaptcha: false });
    console.log('Audit result:', {
      totalFields: audit.totalFields,
      successCount: audit.successCount,
      failureCount: audit.failureCount,
      failures: audit.items.filter(i => i.status !== 'success')
    });

    const name0 = document.getElementById('sed-name-0') as HTMLInputElement;
    const age0 = document.getElementById('sed-age-0') as HTMLInputElement;
    const gender0 = document.getElementById('sed-gender-0') as HTMLSelectElement;

    console.log('Filled values:', {
      name0: name0?.value,
      age0: age0?.value,
      gender0: gender0?.value
    });

    expect(name0.value).toBe(profile.pilgrims[0].fullName);
  });

  it('should detect and autofill Virtual Seva Gruhastha form (matching live TTD layout)', async () => {
    // Switch active tab to tab-seva
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const sevaPanel = document.getElementById('tab-seva')!;
    sevaPanel.classList.add('active');

    const formState = scanForm(profile.pilgrims, profile.general, []);
    expect(formState.elements.length).toBeGreaterThanOrEqual(14);

    const audit = await executeTier1Autofill(formState, { fillAndContinue: false, autoFocusCaptcha: false });
    expect(audit.hasFailures).toBe(false);

    // Verify General Details
    const gothramInput = document.getElementById('seva-gothram') as HTMLInputElement;
    const emailInput = document.getElementById('seva-email') as HTMLInputElement;
    const cityInput = document.getElementById('seva-city') as HTMLInputElement;

    expect(gothramInput.value).toBe(profile.general.gothram || profile.pilgrims[0].gothram || 'Kasyapa');
    expect(emailInput.value).toBe(profile.general.email);
    expect(cityInput.value).toBe(profile.general.city);

    // Verify Devotee 1 & Devotee 2
    const name0 = document.getElementById('seva-name-0') as HTMLInputElement;
    const name1 = document.getElementById('seva-name-1') as HTMLInputElement;
    const idnum0 = document.getElementById('seva-idnum-0') as HTMLInputElement;
    const idnum1 = document.getElementById('seva-idnum-1') as HTMLInputElement;

    expect(name0.value).toBe(profile.pilgrims[0].fullName);
    expect(name1.value).toBe(profile.pilgrims[1].fullName);
    expect(idnum0.value).toBe(profile.pilgrims[0].idNumber);
    expect(idnum1.value).toBe(profile.pilgrims[1].idNumber);
  });

  it('should detect and autofill custom React dropdowns (Gender, Photo ID Proof) and conditionally disabled Photo ID Number', async () => {
    // Create an exact DOM mock of Next.js / React custom dropdowns and disabled inputs
    const container = document.createElement('div');
    container.id = 'react-nextjs-test-panel';
    container.className = 'tab-panel active';
    container.innerHTML = `
      <div class="gruhastha-container">
        <!-- Devotee 1 -->
        <div class="devotee-row">
          <div><label>Name *</label><input type="text" id="react-name-0" name="name" /></div>
          <div><label>Age *</label><input type="number" id="react-age-0" name="age" /></div>
          <div>
            <label>Gender *</label>
            <div id="react-gender-trigger-0" role="button" aria-haspopup="listbox" class="custom-select">
              <span>Select Gender</span>
            </div>
          </div>
          <div>
            <label>Photo ID Proof *</label>
            <button id="react-idtype-trigger-0" type="button" aria-haspopup="listbox" class="custom-select">
              <span>Select ID</span>
            </button>
          </div>
          <div>
            <label>Photo ID Number *</label>
            <input type="text" id="react-idnum-0" name="photoIdNumber" disabled />
          </div>
        </div>
      </div>
    `;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.body.appendChild(container);

    // Setup simulated dropdown open behavior for custom selects
    const genderTrigger = container.querySelector('#react-gender-trigger-0') as HTMLElement;
    genderTrigger.addEventListener('click', () => {
      const dropdown = document.createElement('div');
      dropdown.className = 'cdk-overlay-pane';
      dropdown.setAttribute('role', 'listbox');
      dropdown.innerHTML = `
        <div role="option" class="dropdown-item">Male</div>
        <div role="option" class="dropdown-item">Female</div>
      `;
      document.body.appendChild(dropdown);
    });

    const idTypeTrigger = container.querySelector('#react-idtype-trigger-0') as HTMLElement;
    idTypeTrigger.addEventListener('click', () => {
      const dropdown = document.createElement('div');
      dropdown.className = 'cdk-overlay-pane';
      dropdown.setAttribute('role', 'listbox');
      dropdown.innerHTML = `
        <div role="option" class="dropdown-item">Aadhaar Card</div>
        <div role="option" class="dropdown-item">Passport</div>
      `;
      document.body.appendChild(dropdown);
    });

    const singlePilgrimProfile = {
      ...profile,
      pilgrims: [profile.pilgrims[0]]
    };

    const formState = scanForm(singlePilgrimProfile.pilgrims, singlePilgrimProfile.general, []);
    
    // Check that custom triggers and disabled idNumber were detected
    const detectedGender = formState.elements.find(e => e.fieldKey === 'pilgrim_0_gender');
    const detectedIdType = formState.elements.find(e => e.fieldKey === 'pilgrim_0_idProofType');
    const detectedIdNum = formState.elements.find(e => e.fieldKey === 'pilgrim_0_idNumber');

    expect(detectedGender).toBeDefined();
    expect(detectedIdType).toBeDefined();
    expect(detectedIdNum).toBeDefined();

    const audit = await executeTier1Autofill(formState, { fillAndContinue: false, autoFocusCaptcha: false });
    
    // Verify values were set!
    const nameEl = document.getElementById('react-name-0') as HTMLInputElement;
    const ageEl = document.getElementById('react-age-0') as HTMLInputElement;
    const idNumEl = document.getElementById('react-idnum-0') as HTMLInputElement;

    expect(nameEl.value).toBe(singlePilgrimProfile.pilgrims[0].fullName);
    expect(ageEl.value).toBe(String(singlePilgrimProfile.pilgrims[0].age));
    expect(idNumEl.value).toBe(singlePilgrimProfile.pilgrims[0].idNumber);
    expect(idNumEl.disabled).toBe(false);

    // Clean up
    container.remove();
  });

  it('detects and autofills Differently Abled / Sr. Citizen / Medical Cases 2-Page SPA', async () => {
    // 1. Switch active panel to tab-special
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.scenario-tab').forEach(t => t.classList.remove('active'));
    const tabSpecial = document.getElementById('tab-special');
    tabSpecial?.classList.add('active');

    // 2. Prepare profile
    const specialProfile = createDefaultProfile('Special Test');
    specialProfile.bookingPreset = 'SPECIAL_DISABILITY_AGED';
    specialProfile.attendantConfig = { requiresAttendant: true, companionRelationship: 'Spouse' };

    const p1 = specialProfile.pilgrims[0];
    p1.fullName = 'Ramakrishna Rao';
    p1.age = 45;
    p1.dob = '1981-05-12';
    p1.gender = 'Male';
    p1.idProofType = 'Aadhaar';
    p1.idNumber = '234567890128';
    p1.specialCategory = 'Differently Abled';
    p1.disabilityType = 'Orthopedic / Locomotor';
    p1.disabilityPercentage = 50;
    p1.certificateOrUdidNumber = 'UDID123456789';
    p1.proofDocuments = {
      idProofDoc: {
        fileName: 'aadhaar_scan.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 150000,
        base64Data: btoa('SampleAadhaarContent')
      },
      categoryCertificateDoc: {
        fileName: 'pwd_cert.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 250000,
        base64Data: btoa('SamplePwdCertificateContent')
      }
    };

    const p2 = specialProfile.pilgrims[1];
    p2.fullName = 'Sita Devi';
    p2.age = 42;
    p2.gender = 'Female';
    p2.idProofType = 'Aadhaar';
    p2.idNumber = '345678901239';

    // 3. Scan & Autofill Page 1
    const formStatePage1 = scanForm(specialProfile.pilgrims, specialProfile.general, [], specialProfile);
    expect(formStatePage1.elements.some(e => e.fieldKey === 'special_category')).toBe(true);
    expect(formStatePage1.elements.some(e => e.fieldKey === 'special_attendantRequired')).toBe(true);
    expect(formStatePage1.elements.some(e => e.fieldKey === 'special_disabilityType')).toBe(true);

    const audit1 = await executeTier1Autofill(formStatePage1, { fillAndContinue: false });
    if (audit1.hasFailures) {
      console.log('Audit1 failures:', audit1.items.filter(i => i.status !== 'success'));
    }
    expect(audit1.hasFailures).toBe(false);

    // Verify Page 1 elements received values
    const catSelect = document.getElementById('special-cat') as HTMLSelectElement;
    expect(catSelect.value).toBe('Differently Abled');

    const attendantYesRadio = document.querySelector('input[name="attendant_required"][value="Yes"]') as HTMLInputElement;
    expect(attendantYesRadio.checked).toBe(true);

    // 4. Click Continue to transition to Page 2
    const btnPage1Continue = document.getElementById('btn-special-page1-continue') as HTMLButtonElement;
    btnPage1Continue.addEventListener('click', () => {
      const page1 = document.getElementById('special-page-1')!;
      const page2 = document.getElementById('special-page-2')!;
      page1.style.display = 'none';
      page2.style.display = 'block';

      page2.innerHTML = `
        <div class="form-section">
          <h3>Step 2: Primary Devotee Details</h3>
          <div class="pilgrim-card pilgrim-row" data-pilgrim-index="0">
            <h4>Primary Pilgrim</h4>
            <div class="form-grid">
              <div class="form-group">
                <label for="special-p0-name">Pilgrim Name *</label>
                <input type="text" id="special-p0-name" name="pilgrim_0_name" class="special-controlled" placeholder="Full name on ID">
              </div>
              <div class="form-group">
                <label for="special-p0-age">Age *</label>
                <input type="number" id="special-p0-age" name="pilgrim_0_age" class="special-controlled" min="0" max="120" placeholder="Age">
              </div>
              <div class="form-group">
                <label for="special-p0-dob">Date of Birth *</label>
                <input type="date" id="special-p0-dob" name="pilgrim_0_dob" class="special-controlled">
              </div>
              <div class="form-group">
                <label for="special-p0-gender">Gender *</label>
                <select id="special-p0-gender" name="pilgrim_0_gender" class="special-controlled">
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Transgender">Transgender</option>
                </select>
              </div>
              <div class="form-group">
                <label for="special-p0-id-type">Photo ID Proof *</label>
                <select id="special-p0-id-type" name="pilgrim_0_id_type" class="special-controlled">
                  <option value="Aadhaar">Aadhaar</option>
                  <option value="Passport">Passport</option>
                </select>
              </div>
              <div class="form-group">
                <label for="special-p0-id-num">Photo ID Number *</label>
                <input type="text" id="special-p0-id-num" name="pilgrim_0_id_num" class="special-controlled" placeholder="ID Number">
              </div>
            </div>
          </div>

          <div class="pilgrim-card pilgrim-row" data-pilgrim-index="1">
            <h4>Attendant / Companion Pilgrim</h4>
            <div class="form-grid">
              <div class="form-group">
                <label for="special-p1-name">Attendant Name *</label>
                <input type="text" id="special-p1-name" name="pilgrim_1_name" class="special-controlled" placeholder="Full name on ID">
              </div>
              <div class="form-group">
                <label for="special-p1-age">Age *</label>
                <input type="number" id="special-p1-age" name="pilgrim_1_age" class="special-controlled" min="0" max="120" placeholder="Age">
              </div>
              <div class="form-group">
                <label for="special-p1-gender">Gender *</label>
                <select id="special-p1-gender" name="pilgrim_1_gender" class="special-controlled">
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
              <div class="form-group">
                <label for="special-p1-id-type">Photo ID Proof *</label>
                <select id="special-p1-id-type" name="pilgrim_1_id_type" class="special-controlled">
                  <option value="Aadhaar">Aadhaar</option>
                  <option value="Passport">Passport</option>
                </select>
              </div>
              <div class="form-group">
                <label for="special-p1-id-num">Photo ID Number *</label>
                <input type="text" id="special-p1-id-num" name="pilgrim_1_id_num" class="special-controlled" placeholder="ID Number">
              </div>
            </div>
          </div>
        </div>

        <div class="form-section">
          <h3>Step 3: Document Uploads</h3>
          <div class="form-grid">
            <div class="form-group">
              <label for="special-aadhaar-doc">Primary Devotee Aadhaar / ID Proof Document *</label>
              <input type="file" id="special-aadhaar-doc" name="aadhaar_proof_doc" accept=".pdf,.jpg,.jpeg,.png" class="special-controlled">
            </div>
            <div class="form-group">
              <label for="special-cert-doc">Govt Disability / Medical / Age Certificate *</label>
              <input type="file" id="special-cert-doc" name="category_certificate_doc" accept=".pdf,.jpg,.jpeg,.png" class="special-controlled">
            </div>
          </div>
        </div>
      `;
    });
    btnPage1Continue.click();

    // Verify Page 1 is hidden and Page 2 is visible
    const page1 = document.getElementById('special-page-1');
    const page2 = document.getElementById('special-page-2');
    expect(page1?.style.display).toBe('none');
    expect(page2?.style.display).toBe('block');

    // 5. Scan & Autofill Page 2
    const formStatePage2 = scanForm(specialProfile.pilgrims, specialProfile.general, [], specialProfile);

    // Check detected keys
    const keysPage2 = formStatePage2.elements.map(e => e.fieldKey);
    expect(keysPage2).toContain('pilgrim_0_fullName');
    expect(keysPage2).toContain('pilgrim_0_age');
    expect(keysPage2).toContain('pilgrim_0_dob');
    expect(keysPage2).toContain('pilgrim_0_gender');
    expect(keysPage2).toContain('pilgrim_0_idProofType');
    expect(keysPage2).toContain('pilgrim_0_idNumber');
    expect(keysPage2).toContain('pilgrim_1_fullName');
    expect(keysPage2).toContain('pilgrim_1_age');
    expect(keysPage2).toContain('doc_id_proof');
    expect(keysPage2).toContain('doc_category_cert');

    const audit2 = await executeTier1Autofill(formStatePage2, { fillAndContinue: false });
    expect(audit2.hasFailures).toBe(false);

    // Verify Devotee 1 & Devotee 2 fields
    const p0Name = document.getElementById('special-p0-name') as HTMLInputElement;
    const p0Dob = document.getElementById('special-p0-dob') as HTMLInputElement;
    const p1Name = document.getElementById('special-p1-name') as HTMLInputElement;
    expect(p0Name.value).toBe('Ramakrishna Rao');
    expect(p0Dob.value).toBe('1981-05-12');
    expect(p1Name.value).toBe('Sita Devi');

    // Verify File inputs received files via DataTransfer
    const aadhaarFileInput = document.getElementById('special-aadhaar-doc') as HTMLInputElement;
    const certFileInput = document.getElementById('special-cert-doc') as HTMLInputElement;
    expect(aadhaarFileInput.files).toBeDefined();
    expect(aadhaarFileInput.files?.length).toBe(1);
    expect(aadhaarFileInput.files?.[0].name).toBe('aadhaar_scan.pdf');

    expect(certFileInput.files).toBeDefined();
    expect(certFileInput.files?.length).toBe(1);
    expect(certFileInput.files?.[0].name).toBe('pwd_cert.pdf');
  });

  it('detects and autofills 2 Gruhastha devotees with Material-UI custom dropdowns where Female is listed before Male', async () => {
    const container = document.createElement('div');
    container.id = 'mui-gruhastha-panel';
    container.className = 'tab-panel active';
    container.innerHTML = `
      <div class="gruhastha-mui-root">
        <!-- Devotee 1 -->
        <div class="MuiFormControl-root devotee-card">
          <div class="MuiFormLabel-root">Name *</div>
          <input type="text" id="mui-name-0" name="pilgrimName" />
          <div class="MuiFormLabel-root">Age *</div>
          <input type="number" id="mui-age-0" name="pilgrimAge" />
          <div class="MuiFormLabel-root">Gender *</div>
          <div id="mui-gender-0" class="MuiSelect-select" role="button" tabindex="0" aria-haspopup="listbox">
            Gender
          </div>
          <div class="MuiFormLabel-root">Photo ID Proof *</div>
          <div id="mui-idtype-0" class="MuiSelect-select" role="button" tabindex="0" aria-haspopup="listbox">
            Photo ID Proof
          </div>
          <div class="MuiFormLabel-root">Photo ID Number *</div>
          <input type="text" id="mui-idnum-0" name="photoIdNumber" disabled />
        </div>

        <!-- Devotee 2 -->
        <div class="MuiFormControl-root devotee-card">
          <div class="MuiFormLabel-root">Name *</div>
          <input type="text" id="mui-name-1" name="pilgrimName" />
          <div class="MuiFormLabel-root">Age *</div>
          <input type="number" id="mui-age-1" name="pilgrimAge" />
          <div class="MuiFormLabel-root">Gender *</div>
          <div id="mui-gender-1" class="MuiSelect-select" role="button" tabindex="0" aria-haspopup="listbox">
            Gender
          </div>
          <div class="MuiFormLabel-root">Photo ID Proof *</div>
          <div id="mui-idtype-1" class="MuiSelect-select" role="button" tabindex="0" aria-haspopup="listbox">
            Photo ID Proof
          </div>
          <div class="MuiFormLabel-root">Photo ID Number *</div>
          <input type="text" id="mui-idnum-1" name="photoIdNumber" disabled />
        </div>
      </div>
    `;

    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.body.appendChild(container);

    // Setup simulated dropdown open behavior where "Female" is rendered FIRST
    container.querySelectorAll('.MuiSelect-select').forEach(trigger => {
      trigger.addEventListener('click', () => {
        document.querySelectorAll('.MuiPopover-root').forEach(m => m.remove());
        const menu = document.createElement('div');
        menu.className = 'MuiPopover-root';
        menu.setAttribute('role', 'listbox');

        if (trigger.id.includes('gender')) {
          // FEMALE is placed first to strictly test that Male does not mistakenly match Female!
          menu.innerHTML = `
            <div role="option" class="MuiMenuItem-root">Female</div>
            <div role="option" class="MuiMenuItem-root">Male</div>
          `;
        } else {
          menu.innerHTML = `
            <div role="option" class="MuiMenuItem-root">Passport</div>
            <div role="option" class="MuiMenuItem-root">Aadhaar</div>
            <div role="option" class="MuiMenuItem-root">Voter ID</div>
          `;
        }
        document.body.appendChild(menu);
      });
    });

    const testProfile = createDefaultProfile('Gruhastha Test');
    testProfile.pilgrims[0].fullName = 'PAKA VENU YADAV';
    testProfile.pilgrims[0].age = 20;
    testProfile.pilgrims[0].gender = 'Male';
    testProfile.pilgrims[0].idProofType = 'Aadhaar';
    testProfile.pilgrims[0].idNumber = '456789012345';

    testProfile.pilgrims[1].fullName = 'Onteddu Adithya Vardhan Reddy';
    testProfile.pilgrims[1].age = 21;
    testProfile.pilgrims[1].gender = 'Male';
    testProfile.pilgrims[1].idProofType = 'Aadhaar';
    testProfile.pilgrims[1].idNumber = '567890123456';

    const formState = scanForm(testProfile.pilgrims, testProfile.general, []);
    expect(formState.elements.length).toBe(10); // 5 fields x 2 pilgrims

    const audit = await executeTier1Autofill(formState, { fillAndContinue: false });
    expect(audit.hasFailures).toBe(false);
    expect(audit.successCount).toBe(10);

    const name0 = document.getElementById('mui-name-0') as HTMLInputElement;
    const name1 = document.getElementById('mui-name-1') as HTMLInputElement;
    const idnum0 = document.getElementById('mui-idnum-0') as HTMLInputElement;
    const idnum1 = document.getElementById('mui-idnum-1') as HTMLInputElement;

    expect(name0.value).toBe('PAKA VENU YADAV');
    expect(name1.value).toBe('Onteddu Adithya Vardhan Reddy');
    expect(idnum0.value).toBe('456789012345');
    expect(idnum1.value).toBe('567890123456');

    container.remove();
  });

  it('correctly matches "Aadhaar Card" to "Aadhaar" in audit and autofills 3 pilgrims without clearing gender or truncating ID number', async () => {
    const container = document.createElement('div');
    container.id = 'mui-3pilgrim-panel';
    container.className = 'tab-panel active';
    container.innerHTML = `
      <div class="gruhastha-mui-root">
        <!-- Pilgrim 1 -->
        <div class="MuiFormControl-root devotee-card">
          <div class="MuiFormLabel-root">Name *</div>
          <input type="text" id="p1-name" name="pilgrimName" />
          <div class="MuiFormLabel-root">Age *</div>
          <input type="number" id="p1-age" name="pilgrimAge" />
          <div class="MuiFormLabel-root">Gender *</div>
          <div id="p1-gender" class="MuiSelect-select" role="button" tabindex="0" aria-haspopup="listbox">Gender</div>
          <div class="MuiFormLabel-root">Photo ID Proof *</div>
          <div id="p1-idtype" class="MuiSelect-select" role="button" tabindex="0" aria-haspopup="listbox">Photo ID Proof</div>
          <div class="MuiFormLabel-root">Photo ID Number *</div>
          <input type="text" id="p1-idnum" name="photoIdNumber" disabled />
        </div>

        <!-- Pilgrim 2 -->
        <div class="MuiFormControl-root devotee-card">
          <div class="MuiFormLabel-root">Name *</div>
          <input type="text" id="p2-name" name="pilgrimName" />
          <div class="MuiFormLabel-root">Age *</div>
          <input type="number" id="p2-age" name="pilgrimAge" />
          <div class="MuiFormLabel-root">Gender *</div>
          <div id="p2-gender" class="MuiSelect-select" role="button" tabindex="0" aria-haspopup="listbox">Gender</div>
          <div class="MuiFormLabel-root">Photo ID Proof *</div>
          <div id="p2-idtype" class="MuiSelect-select" role="button" tabindex="0" aria-haspopup="listbox">Photo ID Proof</div>
          <div class="MuiFormLabel-root">Photo ID Number *</div>
          <input type="text" id="p2-idnum" name="photoIdNumber" disabled />
        </div>

        <!-- Pilgrim 3 -->
        <div class="MuiFormControl-root devotee-card">
          <div class="MuiFormLabel-root">Name *</div>
          <input type="text" id="p3-name" name="pilgrimName" />
          <div class="MuiFormLabel-root">Age *</div>
          <input type="number" id="p3-age" name="pilgrimAge" />
          <div class="MuiFormLabel-root">Gender *</div>
          <div id="p3-gender" class="MuiSelect-select" role="button" tabindex="0" aria-haspopup="listbox">Gender</div>
          <div class="MuiFormLabel-root">Photo ID Proof *</div>
          <div id="p3-idtype" class="MuiSelect-select" role="button" tabindex="0" aria-haspopup="listbox">Photo ID Proof</div>
          <div class="MuiFormLabel-root">Photo ID Number *</div>
          <input type="text" id="p3-idnum" name="photoIdNumber" disabled />
        </div>
      </div>
    `;

    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.body.appendChild(container);

    // Setup simulated dropdowns with "Aadhaar Card" instead of just "Aadhaar"
    container.querySelectorAll('.MuiSelect-select').forEach(trigger => {
      trigger.addEventListener('click', () => {
        document.querySelectorAll('.MuiPopover-root').forEach(m => m.remove());
        const menu = document.createElement('div');
        menu.className = 'MuiPopover-root';
        menu.setAttribute('role', 'listbox');

        if (trigger.id.includes('gender')) {
          menu.innerHTML = `
            <div role="option" class="MuiMenuItem-root">Female</div>
            <div role="option" class="MuiMenuItem-root">Male</div>
          `;
        } else {
          // Live TTD portal options: Aadhaar Card, Passport, Voter Card
          menu.innerHTML = `
            <div role="option" class="MuiMenuItem-root">Aadhaar Card</div>
            <div role="option" class="MuiMenuItem-root">Passport</div>
            <div role="option" class="MuiMenuItem-root">Voter Card</div>
          `;
        }
        document.body.appendChild(menu);
      });
    });

    const testProfile = createDefaultProfile('3 Pilgrims Test');
    // Ensure 3 pilgrims
    while (testProfile.pilgrims.length < 3) {
      testProfile.pilgrims.push(createDefaultPilgrim(testProfile.pilgrims.length + 1));
    }
    testProfile.pilgrims[0].fullName = 'Devotee One';
    testProfile.pilgrims[0].age = 45;
    testProfile.pilgrims[0].gender = 'Male';
    testProfile.pilgrims[0].idProofType = 'Aadhaar';
    testProfile.pilgrims[0].idNumber = '100020003000';

    testProfile.pilgrims[1].fullName = 'Devotee Two';
    testProfile.pilgrims[1].age = 40;
    testProfile.pilgrims[1].gender = 'Female';
    testProfile.pilgrims[1].idProofType = 'Aadhaar';
    testProfile.pilgrims[1].idNumber = '206994654066'; // Exact user Aadhaar test

    testProfile.pilgrims[2].fullName = 'Devotee Three';
    testProfile.pilgrims[2].age = 18;
    testProfile.pilgrims[2].gender = 'Male';
    testProfile.pilgrims[2].idProofType = 'Aadhaar';
    testProfile.pilgrims[2].idNumber = '300040005000';

    const formState = scanForm(testProfile.pilgrims, testProfile.general, []);
    expect(formState.elements.length).toBe(15); // 5 fields x 3 pilgrims

    const audit = await executeTier1Autofill(formState, { fillAndContinue: false });
    expect(audit.hasFailures).toBe(false);
    expect(audit.failureCount).toBe(0);
    expect(audit.successCount).toBe(15);

    // Verify all 3 Aadhaar Cards matched expected "Aadhaar" without mismatch error
    const idTypeAudits = audit.items.filter(i => i.fieldKey.includes('idProofType'));
    expect(idTypeAudits.length).toBe(3);
    idTypeAudits.forEach(a => expect(a.status).toBe('success'));

    // Verify Pilgrim 2 ID number has full 12 digits intact
    const p2IdNum = document.getElementById('p2-idnum') as HTMLInputElement;
    expect(p2IdNum.value).toBe('206994654066');

    // Verify Pilgrim 3 Gender is correctly selected as Male
    const p3Gender = document.getElementById('p3-gender') as HTMLElement;
    expect(p3Gender.textContent?.trim()).toBe('Male');

    container.remove();
  });
});
