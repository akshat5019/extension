# Resume Assist — publication draft

## Name

Resume Assist

## Short description

Read resumes attached on enabled job portals, fill matching fields locally, and pause for missing answers.

## Detailed description

Make repetitive job applications easier with a browser-local resume assistant.

Enable Resume Assist on a job portal once and grant access to that hostname. Attach your text-based PDF, DOCX or TXT resume directly to its application form. Resume Assist reads it locally, fills matching empty fields and shows what needs attention. No separate extension upload is needed. Review filled details and optionally save the detected profile. Existing answers and the original attachment are preserved. Custom uploads, embedded frames and already-stored portal resumes may need manual handling.

General field detection is designed for LinkedIn, Naukri, Indeed and company career sites. Portal layouts vary, so custom controls, embedded forms, CAPTCHA and some application steps require manual handling. Compatibility with every portal is not guaranteed.

Optional automatic submission is approved separately for each application. It waits for complete, valid details and a recognized final Submit button, then shows a three-second cancellable countdown. Next and Review steps remain manual. Check the portal for its confirmation after a submission attempt.

Your original resume file and extracted full text are not saved. Detected profile details and the application URL are temporarily held in browser-session storage for the tab. Your reviewed profile and answers you choose to remember are stored locally in your browser. Resume parsing does not use an external AI service, and no analytics are included. Uncheck Remember answers for one-off answers. Use Save answers entered on page to explicitly retain edits you make on a scanned portal form. Saved answers are editable/deletable and appear for review on matching questions on the same website. Passwords, verification codes, attachments and consent choices are not remembered. Filling a form shares the entered answers with that website.

Use Delete my saved data to remove your profile. Browser-local storage is not encrypted by the extension.

## Single purpose

Help users complete job applications from resumes attached on enabled portals and explicit answers to missing questions.

## Permission explanations

- activeTab: temporary access to the application page when the user opens the extension.
- scripting: inject the bundled scanner, autofill logic and optional submission monitor into the selected page.
- storage: retain reviewed profiles/remembered answers locally and detected drafts temporarily for the browser session; users can delete them.
- offscreen: run the bundled document parsers locally without a visible tab.
- optional HTTP/HTTPS host permissions: detect attachments on portals explicitly enabled by the user. Only the chosen hostname is requested, with no ongoing access to all websites by default.

## Data disclosure draft

The extension handles user-supplied resume text, contact information, profile information, and explicit application answers. Parsing runs locally; detected profile details and application URLs are temporarily stored for the browser session. The reviewed profile and answers the user chooses to remember are stored locally; original documents and opted-out one-off answers are not retained by the extension. Remembered questions are associated with website origins and labels. Filled answers are shared with the selected job website, including when the user enables automatic submission.

Use this description to complete the store's current privacy/data-use questionnaire accurately. Do not claim that the extension never handles personal data. It has no analytics, developer-operated backend, sale of data, or remote executable code.

## Items the publisher must supply

- A browser-store developer account and publisher contact details.
- A public HTTPS URL hosting the included privacy policy.
- Verify the provided sample UI screenshots and replace them if tested product behavior differs.
- Any additional graphics requested by the store.
- Accurate privacy disclosures using the store's current questionnaire.
- Verification in an unmanaged browser on the job portals claimed in the listing. Cloud tests use local fixtures with a Chrome API adapter, not logged-in live portal accounts.

Upload `resume-assist.zip`, review the listing, then submit for store review. A submitted package is not publicly available until the store approves and publishes it. This listing is a draft and has not been uploaded.
