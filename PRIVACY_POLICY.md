# Privacy Policy for Pilgrim QuickFill for TTD

**Last Updated:** November 2026  
**Effective Date:** Immediate  

**"Pilgrim QuickFill for TTD"** ("we", "our", or "the extension") is a client-side Chrome Extension engineered to assist devotees in securely storing their family/pilgrim details on their personal device and quickly filling official Tirumala Tirupati Devasthanams (TTD) booking forms.

We believe that your personal booking and identity details are strictly yours. This Privacy Policy discloses our architecture, data handling practices, and complete adherence to the **Google Chrome Web Store User Data Policy** (including the Limited Use requirements).

---

## 1. Zero Telemetry & Local-Only Architecture (Strict Guarantee)
- **Zero Remote Network Requests:** The extension makes **NO** outgoing network requests whatsoever. It contains no analytics, no tracking pixels, no telemetry, no remote scripts, and no external font or stylesheet links.
- **Offline Self-Contained:** Every byte of code, styles, and assets executes strictly inside your local browser sandbox.
- **No Third-Party Sharing:** We do not have servers, databases, or third-party SDKs. Your data never leaves your personal device.

---

## 2. Types of Data Stored & Purpose
The extension allows users to input and store the following details solely to automate form filling on official TTD booking portals:
1. **Pilgrim Identity Information:** Full Name, Age, Gender, Identity Proof Type (Aadhaar, Passport, Voter ID, Driving License, PAN), ID Card Number, and Gothram.
2. **General Contact Details:** Email address, Mobile number, City, State, Country, and PIN Code.
3. **Optional Srivari Seva Details:** Profession, Education, and Volunteer preferences (if participating in Srivari Seva).
4. **Custom Field Selectors:** User-created DOM selector mappings that link TTD input fields to pilgrim attributes (contains no personal identifiable data).

---

## 3. Cryptographic Storage & Security
- All sensitive pilgrim and contact data is stored in the browser's local sandbox (`chrome.storage.local`).
- Users can export encrypted backups protected with **AES-GCM 256-bit encryption** and a key derived via **PBKDF2 SHA-256 with 310,000 iterations** and a random 16-byte cryptographic salt.
- The extension does not store plaintext passwords.

---

## 4. Payment & CAPTCHA Non-Interference
- **Payment Guard:** The extension **never** reads, interacts with, automates, or clicks anything on payment pages (e.g., UPI, Net Banking, Credit/Debit cards). All payment operations must be performed directly and manually by the user.
- **CAPTCHA & Security Integrity:** The extension does not bypass, solve, or interfere with CAPTCHAs, OTPs, login mechanisms, or virtual queue systems. It only focuses the cursor on the CAPTCHA box to save you navigation time.

---

## 5. Chrome Web Store Minimal Permissions
The extension requests only the absolute minimum permissions necessary to perform its helper function:
- `"storage"`: Used to persist user profiles, settings, and custom field mappings locally on your machine.
- `"clipboardWrite"`: Used exclusively in Guided Quick Paste mode (`Ctrl+V` / `Cmd+V`) to copy the active field value to your system clipboard so you can paste it into protected fields.
- `"host_permissions"`: Restricted solely to official TTD booking domains:
  - `*://*.ttdevasthanams.ap.gov.in/*`
  - `*://*.tirupatibalaji.ap.gov.in/*`

---

## 6. User Control & Data Deletion
You retain 100% control over your data:
- **Instant Wipe:** You can wipe all saved profiles, contact details, and settings at any time by clicking the **"Wipe All Local Data"** button in Settings.
- **Uninstalling:** Removing or uninstalling the extension from `chrome://extensions` immediately deletes all stored extension data from your browser storage.

---

## 7. Non-Affiliation Disclaimer
*Pilgrim QuickFill for TTD is an independent browser helper tool created to assist pilgrims and is NOT affiliated with, sponsored by, or endorsed by Tirumala Tirupati Devasthanams (TTD) or the Government of Andhra Pradesh.*

---

## 8. Contact & Open Source Auditing
Because this extension is local-only and has no server infrastructure, the source code and build instructions can be audited directly by inspecting the unpacked extension package or repository.
