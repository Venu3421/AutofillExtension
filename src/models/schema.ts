export type Gender = 'Male' | 'Female' | 'Transgender';
export type IdProofType = 'Aadhaar' | 'Passport' | 'Voter ID' | 'Driving License' | 'PAN';

export interface StoredDoc {
  fileName: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  sizeBytes: number;
  base64Data: string;
}

export type SpecialCategory = 'Differently Abled' | 'Senior Citizen' | 'Medical Cases';

export type DisabilityType =
  | 'Orthopedic / Locomotor'
  | 'Visual Impairment'
  | 'Hearing Impairment'
  | 'Mental / Intellectual'
  | 'Speech & Language'
  | 'Multiple Disabilities'
  | 'Other';

export type MedicalCondition =
  | 'Kidney Transplantation'
  | 'Open Heart Surgery'
  | 'Dialysis'
  | 'Liver Transplantation'
  | 'Brain Surgery'
  | 'Cancer'
  | 'Spine Surgery (Unable to Walk)'
  | 'Other';

export type CompanionRelationship =
  | 'Spouse'
  | 'Dependent Caretaker (Severe Illness / 80+)'
  | 'Other';

export interface AttendantConfig {
  requiresAttendant: boolean;
  companionRelationship: CompanionRelationship;
}

export interface Pilgrim {
  id: string;
  fullName: string;
  age: number | '';
  gender: Gender;
  idProofType: IdProofType;
  idNumber: string;
  gothram?: string;
  photoDataUrl?: string; // Base64 JPEG <= 150KB
  included: boolean; // Whether included in current booking

  // Special Category Fields (Differently Abled / Sr. Citizen / Medical)
  dob?: string; // YYYY-MM-DD or DD-MM-YYYY
  specialCategory?: SpecialCategory;
  disabilityType?: DisabilityType;
  disabilityPercentage?: number; // 1-100
  certificateOrUdidNumber?: string;
  medicalCondition?: MedicalCondition;
  lastSpecialDarshanDate?: string; // ISO date string (YYYY-MM-DD)
  proofDocuments?: {
    idProofDoc?: StoredDoc;
    categoryCertificateDoc?: StoredDoc;
  };
}

export interface GeneralDetails {
  email: string;
  mobile: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  gothram?: string;
}

export interface VolunteerDetails {
  profession: string;
  education: string;
  volunteerExperience: string;
  languages: string;
  preferredLocation: string;
  timeCommitment: string;
  frequency: string;
}

export type BookingPreset = 
  | 'sed300'                 // Special Entry Darshan ₹300 (max 6)
  | 'srivani'                // SRIVANI Trust Break Darshan (default max 4, paste blocked)
  | 'arjitha'                // Arjitha Seva / Electronic DIP (max 2)
  | 'accommodation'          // Accommodation (min 2 occupants)
  | 'srivari_seva'           // Srivari Seva Group Volunteer
  | 'homam'                  // Sri Srinivasa Divyanugraha Homam (needs Gothram)
  | 'SPECIAL_DISABILITY_AGED'; // Differently Abled / Sr. Citizen / Medical Cases (max 2: 1 Primary + 1 Attendant)

export interface Profile {
  id: string;
  name: string;
  bookingPreset: BookingPreset;
  pilgrims: Pilgrim[];
  general: GeneralDetails;
  volunteer: VolunteerDetails;
  attendantConfig?: AttendantConfig;
  createdAt: number;
  updatedAt: number;
}

export interface CustomFieldMapping {
  id: string;
  domainPath: string; // e.g. "ttdevasthanams.ap.gov.in/sed"
  fieldKey: string;   // e.g. "pilgrim_0_fullName", "general_email"
  selector: string;   // Robust CSS selector
  meta: {
    tagName: string;
    id?: string;
    name?: string;
    placeholder?: string;
    ariaLabel?: string;
    nearbyText?: string;
  };
  createdAt: number;
}

export interface ExtensionSettings {
  theme: 'light' | 'dark' | 'system';
  fillAndContinueEnabled: boolean;
  autoFocusCaptcha: boolean;
  showISTClock: boolean;
  targetReleaseTime?: string; // "10:00:00"
  piiConsentAccepted: boolean;
  customFieldMappings: CustomFieldMapping[];
}

export interface EncryptedVaultData {
  version: number;
  salt: string;       // Hex encoded 16-byte random salt
  iv: string;         // Hex encoded 12-byte random IV
  ciphertext: string; // Base64 encoded AES-GCM ciphertext
}

export interface AppState {
  profiles: Profile[];
  activeProfileId: string;
  settings: ExtensionSettings;
}

export const DEFAULT_GENERAL_DETAILS: GeneralDetails = {
  email: 'pilgrim.darshan@example.com',
  mobile: '9876543210',
  city: 'Tirupati',
  state: 'Andhra Pradesh',
  country: 'India',
  pincode: '517504',
  gothram: 'Kasyapa'
};

export const DEFAULT_VOLUNTEER_DETAILS: VolunteerDetails = {
  profession: 'Software Engineer',
  education: 'Graduate',
  volunteerExperience: 'General Seva',
  languages: 'Telugu, English, Hindi',
  preferredLocation: 'Tirumala',
  timeCommitment: '1 Week',
  frequency: 'Once a year'
};

export function createDefaultPilgrim(index: number = 1): Pilgrim {
  const isFemale = index % 2 === 0;
  return {
    id: `pilgrim_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    fullName: isFemale ? 'Lakshmi Devi' : 'Srinivasa Rao',
    age: isFemale ? 34 : 38,
    gender: isFemale ? 'Female' : 'Male',
    idProofType: 'Aadhaar',
    idNumber: isFemale ? '345678901239' : '234567890128',
    gothram: 'Kasyapa',
    included: true
  };
}

export function createDefaultProfile(name: string = 'Family'): Profile {
  return {
    id: `profile_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name,
    bookingPreset: 'sed300',
    pilgrims: [
      createDefaultPilgrim(1),
      createDefaultPilgrim(2)
    ],
    general: { ...DEFAULT_GENERAL_DETAILS },
    volunteer: { ...DEFAULT_VOLUNTEER_DETAILS },
    attendantConfig: {
      requiresAttendant: false,
      companionRelationship: 'Spouse'
    },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  theme: 'system',
  fillAndContinueEnabled: false,
  autoFocusCaptcha: true,
  showISTClock: true,
  targetReleaseTime: '10:00:00',
  piiConsentAccepted: false,
  customFieldMappings: []
};

export const DEFAULT_APP_STATE: AppState = {
  profiles: [createDefaultProfile('Family')],
  activeProfileId: '',
  settings: DEFAULT_SETTINGS
};
// Set activeProfileId after creation
DEFAULT_APP_STATE.activeProfileId = DEFAULT_APP_STATE.profiles[0].id;
