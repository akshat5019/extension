# Resume Assist — publication draft

## Name

Resume Assist

## Short description

Read your resume locally, fill job application forms, and pause for missing answers. Optional submission with your approval.

## Detailed description

Make repetitive job applications easier with a browser-local resume assistant.

Import a text-based PDF, DOCX or TXT resume. Review and save the details it finds, then open a job application and start autofill. Resume Assist fills recognized empty fields first and asks you for missing answers. Existing answers are preserved.

General field detection is designed for LinkedIn, Naukri, Indeed and company career sites. Portal layouts vary, so custom controls, embedded forms, CAPTCHA and some application steps require manual handling. Compatibility with every portal is not guaranteed.

Optional automatic submission is approved separately for each application. It waits for complete, valid details and a recognized final Submit button, then shows a three-second cancellable countdown. Next and Review steps remain manual. Check the portal for its confirmation after a submission attempt.

Your original resume file and extracted text are not saved. Only the profile you review is stored locally in your browser. Resume parsing does not use an external AI service, and no analytics are included. Answers supplied for one application are not saved. Filling a form shares the entered answers with that website.

Use Delete my saved data to remove your profile. Browser-local storage is not encrypted by the extension.

## Single purpose

Help users complete job applications using their locally reviewed resume profile and explicit answers to missing questions.

## Permission explanations

- activeTab: temporary access to the application page when the user opens the extension.
- scripting: inject the bundled scanner, autofill logic and optional submission monitor into the selected page.
- storage: retain the reviewed profile in browser-local storage; users can delete it.

## Data disclosure draft

The extension handles user-supplied resume text, contact information, profile information, and explicit application answers. Parsing runs locally. The reviewed profile is stored locally; original documents and one-off answers are not retained by the extension. Filled answers are shared with the selected job website, including when the user enables automatic submission.

Use this description to complete the store's current privacy/data-use questionnaire accurately. Do not claim that the extension never handles personal data. It has no analytics, developer-operated backend, sale of data, or remote executable code.

## Items the publisher must supply

- A browser-store developer account and publisher contact details.
- A public HTTPS URL hosting the included privacy policy.
- Verify the provided sample UI screenshots and replace them if tested product behavior differs.
- Any additional graphics requested by the store.
- Accurate privacy disclosures using the store's current questionnaire.
- Verification in an unmanaged browser on the job portals claimed in the listing. Cloud tests use local fixtures with a Chrome API adapter, not logged-in live portal accounts.

Upload `resume-assist.zip`, review the listing, then submit for store review. A submitted package is not publicly available until the store approves and publishes it. This listing is a draft and has not been uploaded.
