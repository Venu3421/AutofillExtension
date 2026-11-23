// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { scanForm } from '../src/content/field-detector';
import { executeTier1Autofill, setNativeInputValue, setNativeSelectValue } from '../src/content/fill-engine';
import { createDefaultProfile } from '../src/models/schema';

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
});
