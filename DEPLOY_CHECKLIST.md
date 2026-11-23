# Deployment & Rollout Checklist: Pilgrim QuickFill for TTD

This project is engineered with a **Two-Phase Rollout Strategy**:
1. **Phase 1 (Immediate Personal Use):** Fast, frictionless local installation via Chrome Developer Mode (`Load unpacked`) for your own personal and family TTD bookings. Includes real-time testing on the mock portal and live selector tuning.
2. **Phase 2 (Public Store Publishing):** 100% Manifest V3 and Chrome Web Store User Data compliant release packaging for publishing publicly to the Chrome Web Store, Microsoft Edge Add-ons, and Firefox.

---

## PHASE 1: Immediate Personal Local Install & Live Tuning

### Step 1.1: Build the Extension Locally
Run the build command in the project directory:
```bash
npm run build
```
This command compiles TypeScript via Vite, generates standard extension icons (16px, 48px, 128px), and creates a self-contained production directory in `dist/`.

### Step 1.2: Load Unpacked in Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. In the top-right corner, toggle **"Developer mode"** to **ON**.
3. Click the **"Load unpacked"** button in the top-left corner.
4. Select the `d:\TTDExtension\dist` directory.
5. The **"Pilgrim QuickFill for TTD"** extension will appear in your extensions list. Pin it to your Chrome toolbar for easy access.

### Step 1.3: Rehearse on the Standalone Test Harness (Offline)
Before using the extension during high-pressure live quota releases, rehearse all 3 fill tiers on the offline simulator:
1. Open `d:\TTDExtension\test\ttd-mock-portal.html` in Chrome.
2. Open the extension popup from your toolbar:
   - Accept the one-time **Local-Only Privacy Disclosure**.
   - Fill in your family or test pilgrim details (verify the green "Valid Verhoeff Aadhaar" badge).
   - Verify the top banner displays: `✅ Ready for Booking`.
3. Test **Scenario 1 (₹300 Special Entry Darshan)**:
   - Notice the floating panel docked at the bottom-right of the page showing live IST time.
   - Click `⚡ Fill All (Alt+A)`.
   - Verify that Name, Gender, ID Type, and ID Number are instantly populated.
   - Notice that the **Age** field switches seamlessly to Guided Paste or Type Assist.
   - Verify that the cursor automatically focuses the CAPTCHA input.
   - Toggle to "4 Tickets" on the mock portal to verify the red **Ticket Count Mismatch Guard**.
4. Test **Scenario 2 (Hostile Anti-Autofill)**:
   - Switch to Tab 2 and test how the **Post-Fill Audit Engine** flags cleared inputs and lets you complete them via Quick Paste.
5. Test **Scenario 3 (SRIVANI Break Darshan)**:
   - Switch to Tab 3 where all paste events are blocked.
   - Test **Tier 3 (Type Assist)**: Observe the 4-4-4 Aadhaar display card (`XXXX XXXX XXXX`), type the digits, observe typo alerts, and witness millisecond auto-advance.

### Step 1.4: Real-World TTD Booking & Live Selector Tuning
When booking on `ttdevasthanams.ap.gov.in`:
1. If TTD has modified an input attribute on a new release, open the floating panel and click **`🎯 Map Field`**.
2. Select the field you want to map (e.g. "Pilgrim 1 -> ID Number") and click the input on the TTD page.
3. The custom CSS selector is saved locally in your browser storage.
4. After your booking, click **`📤 Export Mappings`** in the floating panel or in Popup Settings to download a clean, PII-free JSON file of your real-world selectors.

---

## PHASE 2: Pre-Publish Cleanup & Public Store Release

When you are ready to publish the extension publicly for all devotees:

### Step 2.1: Merge Real-World Selectors (Optional)
If you exported any custom field mappings during Phase 1:
- Open `src/content/field-detector.ts`.
- Add any newly discovered TTD element attributes into `PATTERNS` or container heuristics.
- Re-run `npm run test` to ensure 100% test pass.

### Step 2.2: Pre-Publish Hygiene Audit
Verify the following non-negotiable checks:
- [x] Zero personal or family data hardcoded anywhere in the codebase.
- [x] No `console.log` containing sensitive data.
- [x] Zero external network requests (`fetch`, `XMLHttpRequest`, analytics).
- [x] Strict minimal permissions declared in `manifest.json`:
  - `"permissions": ["storage", "clipboardWrite"]`
  - `"host_permissions": ["*://*.ttdevasthanams.ap.gov.in/*", "*://*.tirupatibalaji.ap.gov.in/*"]`
- [x] Verified non-affiliation disclaimer present in popup footer and `PRIVACY_POLICY.md`.

### Step 2.3: Package Production ZIP
Run the package script:
```bash
npm run zip
```
This generates:
`release/pilgrim-quickfill-for-ttd-v1.0.0.zip`

The script automatically verifies:
- `manifest.json` is located right at the root of the ZIP file.
- Zero `.map` source maps or test files are bundled.
- Package size is lightweight (< 150 KB, well below the 350 KB threshold).

### Step 2.4: Chrome Web Store Submission Steps
1. Navigate to the **[Chrome Developer Dashboard](https://chrome.google.com/webstore/devcenter)**.
2. Sign in with your Google Developer account (requires one-time $5 registration fee and 2-Step Verification).
3. Click **"Add new item"** and upload `release/pilgrim-quickfill-for-ttd-v1.0.0.zip`.
4. **Store Listing Details:**
   - **Title:** Pilgrim QuickFill for TTD
   - **Summary:** Fast, local-only, encrypted helper to auto-fill official TTD pilgrim booking forms securely.
   - **Detailed Description:** Emphasize zero telemetry, client-side encryption, and strict non-affiliation with TTD.
   - **Category:** Productivity / Accessibility.
   - **Icons & Screenshots:** Upload 1280x800 screenshots of the popup and floating panel on the mock portal (using dummy names like "Srinivasa Murthy").
5. **Privacy Practices Tab:**
   - **Single Purpose:** "Facilitate fast, secure form filling of pilgrim details on official TTD booking portals."
   - **Permission Justifications:**
     - `storage`: "To persist encrypted pilgrim profiles and user preferences locally on the user's device."
     - `clipboardWrite`: "To enable Guided Quick Paste (Ctrl+V/Cmd+V) into fields where portals block programmatic fills."
     - `host_permissions`: "To detect TTD form inputs and display the assistant on official TTD booking portals."
   - **Data Usage:** Select "Authentication info / Personal communications: NO. Personally identifiable information: Kept locally on device, NOT sold or transferred to third parties."
   - **Privacy Policy URL:** Host `PRIVACY_POLICY.md` on GitHub Pages (e.g. `https://<your-username>.github.io/ttd-extension/privacy`) and paste the link.
6. Submit for review! (Review typically takes 24–48 hours for extensions with minimal permissions).

### Step 2.5: Optional Microsoft Edge & Firefox Publishing
- **Microsoft Edge Add-ons:** Go to [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge). Registration is free. Upload the exact same `release/*.zip`.
- **Firefox Add-ons (AMO):** Go to [Mozilla Add-on Developer Hub](https://addons.mozilla.org/developers/). Submit ZIP. Manifest V3 is supported.
