# Chrome Web Store listing draft

Name: Personal Assist

Short description: Import documents into local person profiles, search the right person, and fill forms after review.

Detailed description:

Import PDF, Word, TXT, CSV, Excel and JSON files into individual local profiles. Search by name, phone, email or company, select a person, and fill supported website form fields. Review uncertain records and duplicates before saving. Missing details can be saved to the selected person after confirmation. Edit, merge, export and delete your local profiles.

Profiles are stored on your device with no cloud account required. Standard parsing works without an AI model. An optional Chrome on-device model assists free-form imports where supported; results require review and a model download may be needed. Scanned images/PDFs need OCR preprocessing, which is not bundled. Existing website values are preserved, undo is available, and forms are submitted manually.

Compatibility varies with website controls. Complex custom widgets, embedded frames, protected pages and CAPTCHA require manual handling. Do not claim support for every site or native model availability on every machine.

Permission justification:

- activeTab: temporary website access when the extension is opened.
- scripting: user-initiated inspection, selected-person filling, and undo on the current tab.
- storage: preferences and migration of the previous single-profile data. Structured profiles use extension-origin IndexedDB.
- Optional HTTP/HTTPS host permissions: only the current hostname is requested when the user chooses persistent access in Settings. Access is revocable and never starts automatic filling.

Publisher actions: add support contact, publish the completed privacy policy, complete Chrome's data-use questionnaire accurately, verify native installation and supported workflows in unmanaged Chrome, and upload current screenshots. This workspace has not submitted the extension to the store.
