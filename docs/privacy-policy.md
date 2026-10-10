# Personal Assist privacy policy

This is a policy draft for the project publisher. Add a publisher contact and effective date before hosting it for a store listing.

Personal Assist stores information about people whom you explicitly import or enter. Each profile is separate and identified by a unique ID. Data can include names, contact and address information, professional fields, optional dates/gender and reviewed custom information, along with source references and update timestamps.

All ordinary processing is local. PDF/DOCX/TXT/CSV/XLSX/JSON files are read on your device. Raw documents and complete extracted text are not permanently stored. Import candidates are held temporarily until you confirm. The local IndexedDB database stores reviewed profile fields and document metadata, not document bytes. Data persists across browser restarts but is not browser-synchronized and is not encrypted by the extension. Removing the extension/browser profile can remove stored data.

There is no backend, analytics, remote parsing service, remote AI call or automatic cloud synchronization. An optional on-device Chrome model can be prepared only after you click its enable button; Chrome may download a model. Document prompts and model inference stay on device. This feature lasts for the current extension interface session. It is browser/hardware-dependent and can be disabled by choosing standard extraction. Model-inferred identities still require human review. OCR is not bundled; scanned documents need preprocessing into readable text.

Websites do not get database access. After selecting a person and explicitly clicking Fill form, that person's relevant fields are sent to the page content script and matching values are entered in the current website. Filling shares those values with the website, including scripts the website runs. Existing values are preserved. The extension does not submit forms automatically. It does not bypass CAPTCHA, authentication or website restrictions. Payment/banking/password/authentication/national-identity fields and consent choices are excluded; birth date/gender filling requires explicit selection for that fill.

New manual answers are not saved automatically. You review values and conflicts, then confirm saving them to the selected profile. Duplicate/merge decisions require confirmation; names alone do not establish a shared identity. You can inspect, edit, delete and merge profiles, export a JSON backup, or delete all data in Settings. JSON exports are unencrypted files containing personal information: safeguard them. Deleting local data does not remove submissions or values already shared with websites.

The extension requests activeTab for the website you open it on, scripting for user-initiated scans/fills, and storage for settings/legacy migration. Optional hostname access can be granted/revoked in Settings. Persistent access does not enable automatic profile disclosure. No persistent access to every website is granted by default. Existing injected scripts can remain until the tab is refreshed after permission revocation.

On upgrading from Resume Assist 1.x, the existing single profile is migrated once to a review-needed local person. Old generic question memories are archived locally and included in full exports, rather than silently mapped to people. Old automatic registrations are removed. Delete all local data also clears this archive and old storage.

Contact: add the publisher's support email/URL before publication.
