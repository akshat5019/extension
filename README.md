# Personal Assist

A runnable Chrome Manifest V3 extension for importing documents into separate local person profiles, searching those profiles, and filling website forms for the person you select. Version 2 replaces Resume Assist's single-profile automatic behavior with **mandatory profile selection, user-triggered filling, and confirmed learning**.

Core features work offline with no account or backend. React + TypeScript provides the popup and full workspace. Dexie/IndexedDB stores profiles and document metadata. Standard local extraction and label mapping work without an AI model. An opt-in Chrome on-device Prompt API provider supports ambiguous free-form documents where the browser exposes it; it is optional, experimental and not a prerequisite.

## Build and install

Requires Node.js 22+ and Chrome/Chromium 120+ for the standard workflow. Optional on-device AI needs a newer compatible Chrome build, supported hardware and availability of its Prompt API/model.

```sh
npm ci
npm run typecheck
npm run build
npm test
npm run test:browser
```

For local Chrome installation:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select `dist`, the folder containing `manifest.json`.
3. Pin Personal Assist from Chrome's Extensions menu.
4. After updating the files, click the extension's Reload button and refresh your website tabs.

Alternatively [download the compiled package](https://github.com/akshat5019/extension/raw/refs/heads/main/downloads/resume-assist.zip), extract it, and select the extracted folder containing `manifest.json`. The historical ZIP filename is retained for existing download links. Do not select the ZIP itself or the repository source folder before building. If a download is blocked by your security software, do not disable protection; use the source checkout and normal build workflow or have the detection reviewed.

This project has not been published to Chrome Web Store. See [publication instructions](docs/PUBLISH.md).

## Import and manage people

Open **Import** in the popup, or **Open workspace** for a full-width extension tab. Choose PDF, DOCX, TXT, CSV, XLSX or a JSON export. The worker separates structured rows and validates values. PDF/DOCX parsing is local; PDF pages are read asynchronously with progress. Import results are staged in memory until confirmation. Closing the interface discards a staged import without partially writing the database.

CSV/XLSX tables need headings such as `Name`, `Email`, `Phone`, `Address`, `City`, `Company`, `Date of birth`, or `Alternate phone`. Each row is one person. XLSX numeric phone cells must be formatted as text to preserve leading zeroes. Use separate alternate columns for multiple identifiers. Formula cells use their stored text/result; macros and formulas are never executed. JSON exports can be imported through the same reviewed workflow; incoming IDs are not silently reused.

For multi-person PDF, DOCX or TXT, prefer labelled records:

```text
Name: Rahul Sharma
Email: rahul@example.com
Phone: 9876543210
Address: 12 Lake Road
Name: Priya Sharma
Email: priya@example.com
Phone: 9123456789
Address: 20 Park Street
```

Repeated `Name:` labels, explicit `---` separators and PDF page boundaries separate records. Free-form resumes may contain many names and identifiers; the extension does **not** pool those into one person. Ambiguous identifiers are withheld or flagged. Unlabelled text is reported as incompletely mapped. Every uncertain record needs a decision; edit its fields, add a separate record to split people, or skip it. Compare records with your source document before confirming.

Potential matches are identified from names, email and normalized phone numbers. Matching names are **review hints**, never unique IDs. Review matching/conflicting information, choose **Update existing**, **Create separate**, or **Skip**, and resolve conflicts using **Replace**, **Keep both**, or **Leave unchanged**. The final import confirmation commits atomically and reports created, updated, review-needed and skipped counts. Identical file hashes prevent repeated writes; stale profile revisions abort the entire transaction for renewed review.

Limits: 25 MB per file, 200 PDF pages, 2 million extracted PDF/DOCX characters, 10,000 records per import, 100 fields per profile, 5,000 characters per field, 20 alternate values per field. Tables report truncation and extra columns. Blank PDF pages, unreadable files, unsupported formats and ambiguous records produce warnings/errors. **OCR is not bundled**: scanned PDFs/images need OCR into text before import. Password-protected, damaged or unusual documents may require conversion. PDF tables with no reliable row boundaries may need CSV export or manual correction.

**People** lets you search, select, inspect, create, edit, delete, review duplicates and explicitly merge profiles. Conflicts must be resolved before editing or merging. Source references, creation/update timestamps and revision numbers are available in the profile view. Keeping multiple conflicting values suppresses their automatic use until you choose a single value. Settings offers a confirmed JSON export and confirmed deletion of all local data. Exports contain unencrypted personal information: keep them private.

## Search and fill forms

1. Open a normal HTTP/HTTPS website form and click the extension icon.
2. Search by name, partial phone, email, company or another stored field. Results are case-insensitive, phone searches ignore common separators, and only 20 results are rendered per page.
3. Select the correct person using the name, phone, email and unique ID shown beside the result.
4. Click **Scan form**, review supported fields and missing values, then **Fill form**.
5. Review the website and submit it manually.

Text, email, phone, number, date, textarea, single-select, labelled radio groups and non-consent checkboxes are supported with conservative mapping. Standard names/contact/address/professional fields use aliases and autocomplete attributes. Unknown questions require an exact reviewed custom-field label. Date of birth and gender require the per-fill **Include date of birth and gender** option, or explicit manual entry. Consent, file uploads, passwords, banking, payment and authentication/identity fields are manual and excluded from general profile memory.

Existing values are preserved. **Undo autofill** restores values written by the extension if you have not subsequently edited them. Switching to another person is blocked until the previous person's autofill is undone; later manual changes remain yours to review. Only selected-profile fields are sent to the content script, only on explicit fill. Content scripts cannot search, export or read the database.

For missing fields, type an application answer in the popup and fill, or edit the website after filling and click **Review answers entered on page**. Review proposed changes, resolve conflicts and click **Confirm save to selected profile**. Use **Use once / discard** to avoid saving. New values are never learned silently. They are associated with the selected profile ID and revision; selecting a different person invalidates the pending learning action.

For multi-step/dynamic forms, use the site's Next/Continue manually and **Scan form** again on each step. Changed field labels/types and changed URLs invalidate earlier mappings. Custom widgets, closed shadow DOM, cross-origin frames, CAPTCHA and browser-internal/restricted pages need manual handling or a future site adapter. No automatic submission, authentication bypass or CAPTCHA automation is included. General field detection does not guarantee compatibility with every website.

## Optional local AI

In **Settings**, click **Prepare / enable on-device AI**. This is explicit permission to prepare Chrome's on-device model, which may require a model download. No documents or profiles are sent to a cloud AI service. If the Prompt API is unavailable, the extension explains that standard offline extraction remains usable. The setting/session lasts only for the current interface window; there is no hidden download or background model startup.

Once enabled, TXT/PDF/DOCX free-form extraction uses the local model through `IntelligenceService`; CSV/XLSX continue deterministic row parsing. Model output must contain verbatim supporting quotes. Unsupported values and sensitive fields are discarded, every inferred person is marked for review, and person boundaries still need human confirmation. Inputs are limited to 60,000 characters and 500 inferred records. This provider is experimental: the cloud Chromium model service is unavailable, so provider/validation/error contracts are tested with a simulated session; real model availability and extraction quality need verification in your browser.

## Privacy, upgrade and persistence

Profiles and document references persist in IndexedDB across browser restarts. No raw documents/full extracted text are retained; import staging and AI prompts are temporary. No analytics, remote fonts or backend are used. The extension does not encrypt the database or exports. Browser/OS security and access to your Chrome profile matter. [Privacy policy](docs/privacy-policy.md).

`activeTab` and `scripting` enable user-initiated scans/fills; `storage` handles legacy migration/settings. Optional website access is requested only for the hostname you choose in Settings, and can be revoked there. Persistent permission does not start automatic filling. Current website access is displayed before a scan. No content script runs automatically on every website.

Upgrading from 1.x imports the saved single profile once with **Needs review** status and removes old automatic script registrations. Old generic answer memories are archived in the database and included as `legacyAnswers` in JSON exports, rather than silently assigned to new people. Refresh existing portal tabs after upgrading. Data deletion clears profiles, import metadata, the legacy archive and old storage; it does not remove information already entered on websites. Back up before removing the extension; uninstalling/reinstalling may erase its local database.

## Development and validation

`npm test` includes real parsing/record separation, IndexedDB transactions with fake-indexeddb, 1,500-profile indexed/paged search, duplicate/conflict handling and source-supported AI output validation. `npm run test:browser` runs actual compiled React UI, document worker, local PDF worker and content/background bundles against a real Chromium DOM and IndexedDB through a Chrome API adapter. It covers PDF/DOCX/CSV/XLSX/JSON, selected-person isolation, confirmation-only learning, persistence across reopening/full Chromium restart, undo, errors, blocked database requests and large-list paging.

Cloud Chromium is managed and blocks unpacked extension installation. These tests do **not** verify native extension installation/permission dialogs, service-worker termination behavior, a native on-device model, or authenticated live websites. Load the package in an unmanaged Chrome browser for those checks. Override `CHROMIUM_PATH` for browser tests; `/usr/bin/chromium` is the default. No test changes managed browser policies.

See [architecture and database replacement](docs/ARCHITECTURE.md), [sample import](docs/example-people.csv), and [manual validation checklist](docs/TESTING.md). `npm run package` builds a root-manifest ZIP at `resume-assist.zip` and `downloads/resume-assist.zip`.

Dependency maintenance: the production dependency audit has three moderate entries in Mammoth's CLI chain (`mammoth` / `argparse` / `sprintf-js`), with no high or critical entries. The bundled extension imports Mammoth's browser module, which does not contain that CLI chain. No patched sprintf-js release was available from the configured registry; the obsolete Mammoth downgrade suggested by audit was not applied. ExcelJS's UUID dependency is overridden to the patched CommonJS-compatible `uuid@11.1.1`, with XLSX read/write compatibility exercised in browser tests.
