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
  evaluateBookingReadiness
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
});
