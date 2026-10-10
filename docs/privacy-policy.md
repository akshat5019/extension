# Resume Assist privacy policy

Resume Assist reads the resume you attach on an enabled job portal and helps fill its application form using detected details and answers you provide.

## Information processed

After you enable a portal and grant access to that hostname, the extension detects your native resume/CV file selection and reads PDF, DOCX and TXT files locally. No separate upload to Resume Assist is needed. It can process contact details, education, skills, employment information and other document text. Raw file bytes pass only between the local content script and hidden extension parser in memory. The original file and extracted full text are not saved. The portal’s original upload proceeds normally and is governed by that portal’s privacy policy.

Detected profile details and the application URL are held temporarily in browser-session extension storage for the tab. This draft is removed when the tab closes, the browser session ends, you save its profile/answers, or you delete your saved data. Matching empty application fields are filled immediately, so review them on the portal. Existing answers are preserved.

The profile you review and save is retained in your browser's local extension storage. It is not synchronized through browser sync, and it is not encrypted by this extension. When Remember answers is enabled, manually supplied answers in the extension are saved for future use. You can also explicitly save answers entered on a scanned portal page; only your edits after scanning are captured, not existing/autofilled values. Basic details update the profile. Other answers are saved with their website and question labels as suggestions for review on future applications. Uncheck Remember answers for one-off answers. Passwords, verification codes, financial/identity numbers, consent controls and file attachments are not remembered. Up to 100 remembered questions are retained.

## Information shared

Resume Assist has no developer-operated backend, analytics, or external AI processing service. It does not send resumes or profiles to the extension developer.

When you ask it to fill a job application, the filled information becomes available to that website. If you enable automatic submission for an application, the extension can click its final Submit button after its completeness checks and cancellable countdown. The receiving website's privacy policy governs its handling of your application. You can attach documents and provide consent directly on that website.

## Control and deletion

You can review automatically filled details, edit/save the detected profile, and edit or forget individual remembered answers. Delete my saved data removes the profile, remembered answers and temporary drafts. Disable on this portal revokes its ongoing upload-detection access. Stop/dismiss upload autofill from its page panel and cancel automatic submission separately. Deleting local data does not delete applications or information previously shared with job websites.

## Permissions

The extension uses activeTab for temporary access when opened, scripting to scan/fill pages and register upload detection, storage for saved details and temporary drafts, and offscreen for local document parsing without a visible tab. Optional HTTP/HTTPS permissions allow enabling individual portals. Access is requested for the specific hostname you choose, persists on that host until revoked, and is not granted for every website by default.

## Publisher contact

Before publication, the publisher must add their contact details here and host this policy at a publicly accessible HTTPS address. This document is a publication draft, not a hosted policy.
