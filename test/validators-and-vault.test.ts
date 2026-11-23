import { describe, it, expect } from 'vitest';
import {
  validateVerhoeff,
  generateVerhoeffCheckDigit,
  validateAadhaar,
  formatAadhaarChunks,
  validatePassport,
  validateAge,
  detectDuplicateIds,
  checkTicketCountMismatch,
  evaluateBookingReadiness,
  validateProofDocument,
  checkSpecialDarshanCooldown,
  MAX_DOC_SIZE_BYTES
} from '../src/validation/validators';
import {
  encryptVault,
  decryptVault
} from '../src/crypto/vault';
import { createDefaultProfile, createDefaultPilgrim } from '../src/models/schema';

describe('Verhoeff Algorithm & Aadhaar Validation', () => {
  it('should generate valid check digit and pass Verhoeff validation', () => {
    // 11-digit prefix starting with 2-9
    const prefix = '23456789012';
    const checkDigit = generateVerhoeffCheckDigit(prefix);
    const fullAadhaar = prefix + checkDigit;

    expect(validateVerhoeff(fullAadhaar)).toBe(true);
    expect(validateAadhaar(fullAadhaar).valid).toBe(true);
  });

  it('should detect single-digit error (typo)', () => {
    const prefix = '54321098765';
    const checkDigit = generateVerhoeffCheckDigit(prefix);
    const valid = prefix + checkDigit;

    // Mutate one digit
    const mutatedDigit = (parseInt(valid[3], 10) + 1) % 10;
    const invalid = valid.substring(0, 3) + mutatedDigit + valid.substring(4);

    expect(validateVerhoeff(invalid)).toBe(false);
    expect(validateAadhaar(invalid).valid).toBe(false);
  });

  it('should detect adjacent transposition error', () => {
    const prefix = '89123456789';
    const checkDigit = generateVerhoeffCheckDigit(prefix);
    const valid = prefix + checkDigit;

    // Transpose adjacent digits at index 4 and 5 (unless they are identical)
    let idx = 0;
    while (idx < valid.length - 1 && valid[idx] === valid[idx + 1]) {
      idx++;
    }
    const transposed =
      valid.substring(0, idx) +
      valid[idx + 1] +
      valid[idx] +
      valid.substring(idx + 2);

    expect(validateVerhoeff(transposed)).toBe(false);
    expect(validateAadhaar(transposed).valid).toBe(false);
  });

  it('should reject 11-digit or 13-digit Aadhaar', () => {
    expect(validateAadhaar('23456789012').valid).toBe(false);
    expect(validateAadhaar('2345678901234').valid).toBe(false);
  });

  it('should reject Aadhaar starting with 0 or 1', () => {
    const prefix0 = '01234567890';
    const check0 = generateVerhoeffCheckDigit(prefix0);
    expect(validateAadhaar(prefix0 + check0).valid).toBe(false);

    const prefix1 = '12345678901';
    const check1 = generateVerhoeffCheckDigit(prefix1);
    expect(validateAadhaar(prefix1 + check1).valid).toBe(false);
  });

  it('should format Aadhaar into 4-4-4 chunks', () => {
    expect(formatAadhaarChunks('234567890128')).toBe('2345 6789 0128');
    expect(formatAadhaarChunks('2345 6789 0128')).toBe('2345 6789 0128');
  });
});

describe('Other Validators', () => {
  it('validates passport format', () => {
    expect(validatePassport('A1234567').valid).toBe(true);
    expect(validatePassport('Z987654321').valid).toBe(true);
    expect(validatePassport('ab').valid).toBe(false);
  });

  it('validates age within bounds', () => {
    expect(validateAge(30).valid).toBe(true);
    expect(validateAge(0).valid).toBe(true);
    expect(validateAge(120).valid).toBe(true);
    expect(validateAge(-1).valid).toBe(false);
    expect(validateAge(121).valid).toBe(false);
    expect(validateAge('').valid).toBe(false);
  });

  it('detects duplicate ID proofs across included pilgrims', () => {
    const p1 = createDefaultPilgrim(1);
    p1.idProofType = 'Aadhaar';
    p1.idNumber = '234567890128';
    p1.fullName = 'Devotee One';
    p1.included = true;

    const p2 = createDefaultPilgrim(2);
    p2.idProofType = 'Aadhaar';
    p2.idNumber = '234567890128'; // DUPLICATE
    p2.fullName = 'Devotee Two';
    p2.included = true;

    const res = detectDuplicateIds([p1, p2]);
    expect(res.hasDuplicates).toBe(true);
    expect(res.duplicates.length).toBeGreaterThan(0);
  });

  it('checks ticket count mismatch', () => {
    const mismatch = checkTicketCountMismatch(4, 2);
    expect(mismatch.mismatch).toBe(true);
    expect(mismatch.message).toContain('4 pilgrim form(s)');

    const match = checkTicketCountMismatch(2, 2);
    expect(match.mismatch).toBe(false);
  });

  it('evaluates booking readiness accurately', () => {
    const profile = createDefaultProfile('Family');
    const p1 = profile.pilgrims[0];
    const prefix1 = '23456789012';
    p1.fullName = 'Srinivasa Murthy';
    p1.age = 45;
    p1.idProofType = 'Aadhaar';
    p1.idNumber = prefix1 + generateVerhoeffCheckDigit(prefix1);
    p1.included = true;

    // Deselect second pilgrim for test
    profile.pilgrims[1].included = false;

    profile.general.email = 'devotee@example.com';
    profile.general.mobile = '9876543210';
    profile.general.pincode = '517504';

    const report = evaluateBookingReadiness(profile);
    expect(report.isReady).toBe(true);
    expect(report.includedCount).toBe(1);
  });
});

describe('AES-GCM Encryption & Vault', () => {
  it('should encrypt and decrypt data round-trip successfully', async () => {
    const secretData = JSON.stringify({ message: 'Govinda Govinda', secret: 108 });
    const passphrase = 'SuperSecurePassphrase#2026';

    const vault = await encryptVault(secretData, passphrase);
    expect(vault.version).toBe(1);
    expect(vault.salt).toHaveLength(32); // 16 bytes in hex = 32 chars
    expect(vault.iv).toHaveLength(24);   // 12 bytes in hex = 24 chars
    expect(vault.ciphertext.length).toBeGreaterThan(0);

    const decrypted = await decryptVault(vault, passphrase);
    expect(decrypted).toBe(secretData);
    const parsed = JSON.parse(decrypted);
    expect(parsed.message).toBe('Govinda Govinda');
  });

  it('should reject decryption with wrong passphrase', async () => {
    const secretData = 'Confidential Pilgrim Info';
    const passphrase = 'CorrectPassword123';
    const vault = await encryptVault(secretData, passphrase);

    await expect(decryptVault(vault, 'WrongPassword456')).rejects.toThrow();
  });

  it('supports backwards-compatible decryption of v1 vaults without new special fields', async () => {
    const validLegacyAadhaar = '23456789012' + generateVerhoeffCheckDigit('23456789012');
    // Legacy profile JSON without specialCategory, attendantConfig, or proofDocuments
    const legacyProfileJson = JSON.stringify({
      id: 'profile_legacy_1',
      name: 'Old Family Profile',
      bookingPreset: 'sed300',
      pilgrims: [
        {
          id: 'pilgrim_1',
          fullName: 'Venkateswara Swamy',
          age: 40,
          gender: 'Male',
          idProofType: 'Aadhaar',
          idNumber: validLegacyAadhaar,
          included: true
        }
      ],
      general: { email: 'v@example.com', mobile: '9876543210' },
      volunteer: { profession: 'Eng' },
      createdAt: 1700000000000,
      updatedAt: 1700000000000
    });

    const vault = await encryptVault(legacyProfileJson, 'VaultPass#123');
    const decrypted = await decryptVault(vault, 'VaultPass#123');
    const parsed = JSON.parse(decrypted);

    expect(parsed.name).toBe('Old Family Profile');
    expect(parsed.pilgrims[0].fullName).toBe('Venkateswara Swamy');
    expect(parsed.attendantConfig).toBeUndefined();
    expect(parsed.pilgrims[0].proofDocuments).toBeUndefined();

    // Verify readiness evaluator handles it safely with defaults
    const report = evaluateBookingReadiness(parsed);
    expect(report.pilgrimErrors).toEqual({});
  });
});

describe('Special Disability / Aged / Medical Validation & Proof Documents', () => {
  it('validates proof document file size (< 1 MB) and MIME types strictly', () => {
    // Valid PDF (< 1 MB)
    expect(validateProofDocument({
      sizeBytes: 500 * 1024,
      mimeType: 'application/pdf',
      fileName: 'medical.pdf'
    }).valid).toBe(true);

    // Valid JPEG
    expect(validateProofDocument({
      sizeBytes: 850 * 1024,
      mimeType: 'image/jpeg',
      fileName: 'aadhaar.jpg'
    }).valid).toBe(true);

    // Valid PNG
    expect(validateProofDocument({
      sizeBytes: 1024 * 1024 - 10,
      mimeType: 'image/png',
      fileName: 'cert.png'
    }).valid).toBe(true);

    // Reject >= 1 MB (1048576 bytes)
    const over1Mb = validateProofDocument({
      sizeBytes: 1048576,
      mimeType: 'application/pdf',
      fileName: 'large.pdf'
    });
    expect(over1Mb.valid).toBe(false);
    expect(over1Mb.error).toContain('1 MB limit');

    // Reject invalid mime type (e.g. executable or text)
    const invalidMime = validateProofDocument({
      sizeBytes: 200 * 1024,
      mimeType: 'application/zip' as any,
      fileName: 'docs.zip'
    });
    expect(invalidMime.valid).toBe(false);
    expect(invalidMime.error).toContain('Invalid file format');
  });

  it('calculates 90-day special darshan cooldown accurately', () => {
    const today = new Date('2026-11-23T00:00:00Z');

    // Booking 40 days ago -> cooldown active
    const fortyDaysAgo = new Date('2026-10-14T00:00:00Z').toISOString().split('T')[0];
    const cd1 = checkSpecialDarshanCooldown(fortyDaysAgo, today);
    expect(cd1.inCooldown).toBe(true);
    expect(cd1.daysSince).toBe(40);
    expect(cd1.remainingDays).toBe(50);
    expect(cd1.message).toContain('40 day(s) ago (50 day(s) remaining)');

    // Booking 95 days ago -> cooldown expired
    const ninetyFiveDaysAgo = new Date('2026-08-20T00:00:00Z').toISOString().split('T')[0];
    const cd2 = checkSpecialDarshanCooldown(ninetyFiveDaysAgo, today);
    expect(cd2.inCooldown).toBe(false);

    // Undefined date -> no cooldown
    expect(checkSpecialDarshanCooldown(undefined, today).inCooldown).toBe(false);
  });

  it('enforces 2-person max limit and attendant rules for SPECIAL_DISABILITY_AGED', () => {
    const profile = createDefaultProfile('Special Profile');
    profile.bookingPreset = 'SPECIAL_DISABILITY_AGED';

    // 1 Primary + 1 Attendant + 1 Extra = 3 included pilgrims
    const p3 = createDefaultPilgrim(3);
    p3.included = true;
    profile.pilgrims.push(p3);
    profile.pilgrims.forEach(p => p.included = true);

    const reportOver = evaluateBookingReadiness(profile);
    expect(reportOver.generalErrors.some(e => e.includes('maximum 2 persons'))).toBe(true);

    // Companion attendant warning when requiresAttendant is true but only 1 pilgrim selected
    profile.pilgrims = [profile.pilgrims[0]];
    profile.pilgrims[0].included = true;
    profile.attendantConfig = { requiresAttendant: true, companionRelationship: 'Spouse' };

    const reportSingle = evaluateBookingReadiness(profile);
    expect(reportSingle.warnings.some(w => w.includes('Companion attendant is enabled, but only 1 person'))).toBe(true);

    // Spouse advisory warning when companionRelationship is not Spouse
    profile.attendantConfig.companionRelationship = 'Other';
    const reportNonSpouse = evaluateBookingReadiness(profile);
    expect(reportNonSpouse.warnings.some(w => w.includes('Only Spouse as attendant'))).toBe(true);
  });

  it('validates category requirements for Senior Citizen, Differently Abled, and Medical Cases', () => {
    const profile = createDefaultProfile('Special Profile');
    profile.bookingPreset = 'SPECIAL_DISABILITY_AGED';
    profile.pilgrims = [profile.pilgrims[0]];
    const p1 = profile.pilgrims[0];
    p1.included = true;

    // 1. Senior Citizen under 65 -> Error
    p1.specialCategory = 'Senior Citizen';
    p1.age = 62;
    const reportSr = evaluateBookingReadiness(profile);
    expect(reportSr.pilgrimErrors[p1.id]?.some(e => e.includes('requires age 65 or above'))).toBe(true);

    // 2. Differently Abled -> Requires disabilityType and warns if <= 20%
    p1.specialCategory = 'Differently Abled';
    p1.age = 40;
    p1.disabilityType = undefined;
    p1.disabilityPercentage = 15;
    const reportDA = evaluateBookingReadiness(profile);
    expect(reportDA.pilgrimErrors[p1.id]?.some(e => e.includes('Disability Type is required'))).toBe(true);
    expect(reportDA.warnings.some(w => w.includes('>20% disability'))).toBe(true);

    // 3. Medical Cases -> Requires medicalCondition
    p1.specialCategory = 'Medical Cases';
    p1.medicalCondition = undefined;
    const reportMed = evaluateBookingReadiness(profile);
    expect(reportMed.pilgrimErrors[p1.id]?.some(e => e.includes('Medical Condition is required'))).toBe(true);
  });
});
