import { Pilgrim, Profile, BookingPreset } from '../models/schema';

// --- Verhoeff Algorithm Tables ---
const VERHOEFF_D: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];

const VERHOEFF_P: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];

const VERHOEFF_INV: number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/**
 * Validates a number string using the Verhoeff checksum algorithm.
 */
export function validateVerhoeff(numStr: string): boolean {
  if (!numStr || !/^\d+$/.test(numStr)) return false;
  let c = 0;
  const digits = numStr.split('').map(Number).reverse();
  for (let i = 0; i < digits.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits[i]]];
  }
  return c === 0;
}

/**
 * Computes the Verhoeff checksum digit for a numerical prefix.
 */
export function generateVerhoeffCheckDigit(numStr: string): number {
  let c = 0;
  const digits = numStr.split('').map(Number).reverse();
  for (let i = 0; i < digits.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][digits[i]]];
  }
  return VERHOEFF_INV[c];
}

/**
 * Validates 12-digit Indian Aadhaar number:
 * 1. Exactly 12 digits
 * 2. Does not start with 0 or 1 (UIDAI standard)
 * 3. Passes Verhoeff checksum
 */
export function validateAadhaar(aadhaar: string): { valid: boolean; error?: string } {
  const clean = aadhaar.replace(/[\s-]/g, '');
  if (!clean) return { valid: false, error: 'Aadhaar number is required' };
  if (!/^\d+$/.test(clean)) return { valid: false, error: 'Aadhaar must contain only digits' };
  if (clean.length !== 12) return { valid: false, error: `Aadhaar must be 12 digits (currently ${clean.length})` };
  if (clean.startsWith('0') || clean.startsWith('1')) {
    return { valid: false, error: 'Aadhaar cannot begin with 0 or 1' };
  }
  if (!validateVerhoeff(clean)) {
    return { valid: false, error: 'Aadhaar failed Verhoeff checksum (invalid check digit)' };
  }
  return { valid: true };
}

/**
 * Formats 12-digit Aadhaar into 4-4-4 blocks (e.g. "1234 5678 9012").
 */
export function formatAadhaarChunks(aadhaar: string): string {
  const clean = aadhaar.replace(/[\s-]/g, '');
  return clean.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

/**
 * Validates passport number (alphanumeric 6–15 characters).
 */
export function validatePassport(passport: string): { valid: boolean; error?: string } {
  const clean = passport.trim().toUpperCase();
  if (!clean) return { valid: false, error: 'Passport number is required' };
  if (!/^[A-Z0-9]{6,15}$/.test(clean)) {
    return { valid: false, error: 'Passport must be 6–15 alphanumeric characters' };
  }
  return { valid: true };
}

/**
 * Validates PAN number (5 letters, 4 digits, 1 letter).
 */
export function validatePAN(pan: string): { valid: boolean; error?: string } {
  const clean = pan.trim().toUpperCase();
  if (!clean) return { valid: false, error: 'PAN number is required' };
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(clean)) {
    return { valid: false, error: 'PAN must follow standard format (e.g. ABCDE1234F)' };
  }
  return { valid: true };
}

/**
 * Generic ID validation based on ID proof type.
 */
export function validateIdProof(type: string, idNumber: string): { valid: boolean; error?: string } {
  const clean = idNumber.trim();
  if (!clean) return { valid: false, error: `${type} number is required` };

  switch (type) {
    case 'Aadhaar':
      return validateAadhaar(clean);
    case 'Passport':
      return validatePassport(clean);
    case 'PAN':
      return validatePAN(clean);
    case 'Voter ID':
      if (clean.length < 5 || clean.length > 20) {
        return { valid: false, error: 'Voter ID must be 5–20 characters' };
      }
      return { valid: true };
    case 'Driving License':
      if (clean.length < 8 || clean.length > 20) {
        return { valid: false, error: 'Driving License must be 8–20 characters' };
      }
      return { valid: true };
    default:
      if (clean.length < 3) return { valid: false, error: 'ID number is too short' };
      return { valid: true };
  }
}

/**
 * Validates pilgrim age (0–120).
 */
export function validateAge(age: number | ''): { valid: boolean; error?: string } {
  if (age === '' || age === undefined || age === null) {
    return { valid: false, error: 'Age is required' };
  }
  const n = Number(age);
  if (isNaN(n) || !Number.isInteger(n)) return { valid: false, error: 'Age must be an integer' };
  if (n < 0 || n > 120) return { valid: false, error: 'Age must be between 0 and 120' };
  return { valid: true };
}

/**
 * Validates email address.
 */
export function validateEmail(email: string): { valid: boolean; error?: string } {
  const clean = email.trim();
  if (!clean) return { valid: false, error: 'Email is required' };
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(clean)) return { valid: false, error: 'Invalid email format' };
  return { valid: true };
}

/**
 * Validates mobile number (10 digits for India or 10-15 digits international).
 */
export function validateMobile(mobile: string): { valid: boolean; error?: string } {
  const clean = mobile.replace(/[\s-+()]/g, '');
  if (!clean) return { valid: false, error: 'Mobile number is required' };
  if (!/^\d{10,15}$/.test(clean)) {
    return { valid: false, error: 'Mobile must be 10–15 digits' };
  }
  return { valid: true };
}

/**
 * Validates Indian PIN code (6 digits).
 */
export function validatePincode(pincode: string, country: string = 'India'): { valid: boolean; error?: string } {
  const clean = pincode.replace(/\s/g, '');
  if (!clean) return { valid: false, error: 'Pincode is required' };
  if (country.toLowerCase() === 'india') {
    if (!/^[1-9][0-9]{5}$/.test(clean)) {
      return { valid: false, error: 'Indian PIN code must be 6 digits and cannot start with 0' };
    }
  } else {
    if (clean.length < 3 || clean.length > 12) {
      return { valid: false, error: 'Postal code must be 3–12 characters' };
    }
  }
  return { valid: true };
}

/**
 * Finds duplicate ID numbers across included pilgrims in a profile.
 */
export function detectDuplicateIds(pilgrims: Pilgrim[]): { hasDuplicates: boolean; duplicates: string[] } {
  const included = pilgrims.filter(p => p.included && p.idNumber.trim());
  const seen = new Map<string, string[]>();
  const duplicates: string[] = [];

  for (const p of included) {
    const key = `${p.idProofType}:${p.idNumber.replace(/[\s-]/g, '').toUpperCase()}`;
    if (!seen.has(key)) {
      seen.set(key, [p.fullName || 'Unnamed']);
    } else {
      const list = seen.get(key)!;
      list.push(p.fullName || 'Unnamed');
      duplicates.push(`Duplicate ${p.idProofType} (${p.idNumber}) shared by: ${list.join(', ')}`);
    }
  }

  return {
    hasDuplicates: duplicates.length > 0,
    duplicates
  };
}

/**
 * Checks ticket count mismatch between detected rows on page and selected pilgrims.
 */
export function checkTicketCountMismatch(detectedCount: number, includedPilgrimCount: number): {
  mismatch: boolean;
  message?: string;
  detectedCount: number;
  includedPilgrimCount: number;
} {
  if (detectedCount > 0 && detectedCount !== includedPilgrimCount) {
    return {
      mismatch: true,
      detectedCount,
      includedPilgrimCount,
      message: `TTD page has ${detectedCount} pilgrim form(s), but you have ${includedPilgrimCount} pilgrim(s) selected in your active profile!`
    };
  }
  return { mismatch: false, detectedCount, includedPilgrimCount };
}

export const MAX_DOC_SIZE_BYTES = 1048576; // 1 MB (1024 * 1024 bytes)
export const ALLOWED_DOC_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

/**
 * Validates document proof file (size < 1 MB, valid MIME types: PDF, JPEG, PNG).
 */
export function validateProofDocument(doc?: { sizeBytes: number; mimeType: string; fileName?: string }): { valid: boolean; error?: string } {
  if (!doc) return { valid: false, error: 'Document is required' };
  if (doc.sizeBytes >= MAX_DOC_SIZE_BYTES) {
    const kb = (doc.sizeBytes / 1024).toFixed(0);
    return {
      valid: false,
      error: `File size exceeds 1 MB limit (${kb} KB / 1024 KB max). Please compress or choose a smaller file.`
    };
  }
  const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
  if (!allowed.includes(doc.mimeType)) {
    return {
      valid: false,
      error: `Invalid file format "${doc.mimeType}". Only PDF, JPEG, and PNG files are accepted.`
    };
  }
  return { valid: true };
}

/**
 * Checks TTD's 90-day cooldown between special category bookings (Differently Abled, Sr. Citizen, Medical).
 */
export function checkSpecialDarshanCooldown(
  lastDateStr?: string,
  targetDate: Date = new Date()
): {
  inCooldown: boolean;
  daysSince?: number;
  remainingDays?: number;
  message?: string;
} {
  if (!lastDateStr) return { inCooldown: false };
  const lastDate = new Date(lastDateStr);
  if (isNaN(lastDate.getTime())) return { inCooldown: false };

  const diffMs = targetDate.getTime() - lastDate.getTime();
  const daysSince = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (daysSince >= 0 && daysSince < 90) {
    const remainingDays = 90 - daysSince;
    return {
      inCooldown: true,
      daysSince,
      remainingDays,
      message: `TTD enforces a 90-day cooldown between special darshans. Your last booking was ${daysSince} day(s) ago (${remainingDays} day(s) remaining).`
    };
  }

  return { inCooldown: false, daysSince };
}

export interface ReadinessReport {
  isReady: boolean;
  includedCount: number;
  pilgrimErrors: Record<string, string[]>;
  generalErrors: string[];
  warnings: string[];
}

/**
 * Comprehensive Booking Readiness evaluation for a profile.
 */
export function evaluateBookingReadiness(profile: Profile): ReadinessReport {
  const pilgrimErrors: Record<string, string[]> = {};
  const generalErrors: string[] = [];
  const warnings: string[] = [];

  const included = profile.pilgrims.filter(p => p.included);

  if (included.length === 0) {
    generalErrors.push('No pilgrims selected for booking. Select at least 1 pilgrim.');
  }

  // Quota preset limits
  const preset: BookingPreset = profile.bookingPreset || 'sed300';
  if (preset === 'sed300' && included.length > 6) {
    warnings.push('₹300 Special Entry Darshan allows maximum 6 pilgrims per booking.');
  } else if (preset === 'srivani' && included.length > 4) {
    warnings.push('SRIVANI Trust Break Darshan typically allows up to 4 pilgrims per donor.');
  } else if (preset === 'arjitha' && included.length > 2) {
    warnings.push('Arjitha Seva / Electronic DIP allows maximum 2 pilgrims per application.');
  } else if (preset === 'accommodation' && included.length < 2) {
    warnings.push('TTD Accommodation requires minimum 2 occupants per room.');
  } else if (preset === 'SPECIAL_DISABILITY_AGED') {
    if (included.length > 2) {
      generalErrors.push('Differently Abled / Sr. Citizen / Medical booking allows maximum 2 persons (1 Primary + 1 Attendant).');
    }
    const reqAttendant = profile.attendantConfig?.requiresAttendant;
    if (reqAttendant && included.length < 2) {
      warnings.push('Companion attendant is enabled, but only 1 person is selected. Please select an attendant or uncheck attendant option.');
    }
    if (reqAttendant && profile.attendantConfig?.companionRelationship && profile.attendantConfig.companionRelationship !== 'Spouse') {
      warnings.push("TTD's official rule allows Only Spouse as attendant (exceptions apply only to severe illness/mental disability or 80+ cases with prior verification).");
    }
  }

  // Validate each included pilgrim
  for (let i = 0; i < included.length; i++) {
    const p = included[i];
    const errors: string[] = [];

    if (!p.fullName.trim()) {
      errors.push('Full Name is required');
    } else if (p.fullName.trim().length < 2) {
      errors.push('Full Name is too short');
    }

    const ageCheck = validateAge(p.age);
    if (!ageCheck.valid && ageCheck.error) {
      errors.push(ageCheck.error);
    }

    const idCheck = validateIdProof(p.idProofType, p.idNumber);
    if (!idCheck.valid && idCheck.error) {
      errors.push(idCheck.error);
    }

    if (preset === 'homam' && (!p.gothram || !p.gothram.trim())) {
      warnings.push(`Pilgrim ${i + 1} (${p.fullName || 'Unnamed'}): Gothram is recommended for Sri Srinivasa Divyanugraha Homam`);
    }

    if (preset === 'SPECIAL_DISABILITY_AGED' && i === 0) {
      // Primary pilgrim special category validation
      if (p.specialCategory === 'Senior Citizen') {
        if (typeof p.age === 'number' && p.age < 65) {
          errors.push(`Senior Citizen category requires age 65 or above (currently ${p.age})`);
        }
        if (!p.proofDocuments?.idProofDoc) {
          warnings.push('Age Proof document (< 1 MB) is required for Senior Citizen verification.');
        }
      } else if (p.specialCategory === 'Differently Abled') {
        if (!p.disabilityType) {
          errors.push('Disability Type is required for Differently Abled category');
        }
        if (typeof p.disabilityPercentage === 'number' && p.disabilityPercentage <= 20) {
          warnings.push('Many TTD guides cite >20% disability; verify against your Govt certificate.');
        }
        if (!p.proofDocuments?.categoryCertificateDoc) {
          warnings.push('Govt Disability Certificate / UDID card (< 1 MB) is required.');
        }
      } else if (p.specialCategory === 'Medical Cases') {
        if (!p.medicalCondition) {
          errors.push('Medical Condition is required for Medical Cases category');
        }
        if (!p.proofDocuments?.categoryCertificateDoc) {
          warnings.push('Hospital / Surgical discharge summary or certificate (< 1 MB) is required.');
        }
      }

      // Check document sizes and formats if provided
      if (p.proofDocuments?.idProofDoc) {
        const docCheck = validateProofDocument(p.proofDocuments.idProofDoc);
        if (!docCheck.valid && docCheck.error) {
          errors.push(`ID Proof: ${docCheck.error}`);
        }
      }
      if (p.proofDocuments?.categoryCertificateDoc) {
        const docCheck = validateProofDocument(p.proofDocuments.categoryCertificateDoc);
        if (!docCheck.valid && docCheck.error) {
          errors.push(`Category Certificate: ${docCheck.error}`);
        }
      }

      // 90-day cooldown check
      if (p.lastSpecialDarshanDate) {
        const cd = checkSpecialDarshanCooldown(p.lastSpecialDarshanDate);
        if (cd.inCooldown && cd.message) {
          warnings.push(`Pilgrim 1 (${p.fullName || 'Primary'}): ${cd.message}`);
        }
      }
    }

    if (errors.length > 0) {
      pilgrimErrors[p.id] = errors;
    }
  }

  // Duplicate IDs
  const dupCheck = detectDuplicateIds(included);
  if (dupCheck.hasDuplicates) {
    dupCheck.duplicates.forEach(d => generalErrors.push(d));
  }

  // General details validation
  const emailCheck = validateEmail(profile.general.email);
  if (!emailCheck.valid && emailCheck.error) {
    generalErrors.push(`Contact: ${emailCheck.error}`);
  }

  const mobileCheck = validateMobile(profile.general.mobile);
  if (!mobileCheck.valid && mobileCheck.error) {
    generalErrors.push(`Contact: ${mobileCheck.error}`);
  }

  if (profile.general.pincode) {
    const pinCheck = validatePincode(profile.general.pincode, profile.general.country);
    if (!pinCheck.valid && pinCheck.error) {
      generalErrors.push(`Contact: ${pinCheck.error}`);
    }
  }

  // Srivari Seva specific warnings
  if (preset === 'srivari_seva') {
    if (!profile.volunteer.profession) {
      warnings.push('Srivari Seva: Profession is recommended for volunteer allocation');
    }
    if (!profile.volunteer.languages) {
      warnings.push('Srivari Seva: Known languages recommended');
    }
  }

  const isReady = Object.keys(pilgrimErrors).length === 0 && generalErrors.length === 0;

  return {
    isReady,
    includedCount: included.length,
    pilgrimErrors,
    generalErrors,
    warnings
  };
}
