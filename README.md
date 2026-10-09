# Resume Assist

A Chrome / Edge extension for Naukri, LinkedIn, Indeed, and company career sites. Import your resume and review your profile. Start autofill to fill known details immediately, then pause for missing answers. Optionally enable automatic submission for the current application.

## Build and install

Requires Node.js 22 or newer and Chrome/Edge 120 or newer.

```sh
npm ci
npm run build
npm test
npm run test:browser
```

Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**, click **Load unpacked**, and select the generated `dist` folder.

1. Click Resume Assist. Choose a **text-based PDF, DOCX or TXT** resume (up to 10 MB). Image-only scans require manual entry; OCR is not included.
2. Check all extracted details, add your location and other information, and click **Save profile**. Extraction is conservative: ambiguous information stays blank rather than being guessed.
3. On Naukri, LinkedIn Easy Apply, Indeed, or a company career site, open the application form and choose **Fill application**. To submit automatically, check **Submit this application automatically when complete**. This approval applies to that page only and is not stored for future applications.
4. Click **Start autofill**. Known details are filled immediately. Answer missing questions in the extension and click **Fill missing answers & resume**, or complete them directly on the portal. Attach your resume and choose consent options yourself. Optional questions also pause submission unless you explicitly choose **Leave unanswered optional fields blank**.
5. With automatic submission enabled, a status panel stays on the portal even after the popup closes. It waits for complete, valid answers and a unique enabled final Submit button, then shows a **3-second cancellable countdown**. Edits restart the countdown. It clicks Submit at most once; an attempted click is not proof that the portal accepted the application. Check for the portal's confirmation. Cancel from the page panel or the extension popup at any time.
6. **Use Next / Review yourself and restart autofill on each new step.** The extension never guesses that a Next button is Submit. A URL change, removed form, or 10-minute timeout stops the current automatic-submission session.

## Coverage and limits

The extension uses visible labels, ARIA labels, names, and autocomplete attributes, rather than fixed portal selectors. Native text inputs, textareas and single-select dropdowns are supported; React forms receive native input/change events. Existing values are preserved. Salary, notice period, work authorization, sponsorship, demographic information and consent are never inferred from your resume. Questions not found in your saved profile are shown for explicit answers.

Resume attachment, checkboxes, radio buttons, custom dropdowns, shadow DOM, and embedded cross-origin forms may require manual entry. Open an embedded application directly where possible. Passwords are excluded from autofill. Automatic submission stops for detected CAPTCHA, custom/embedded controls, account fields, validation errors, and ambiguous submit buttons. These pages require manual submission.

Detection is general across job platforms; it does not depend on a fixed list of allowed portals. Universal compatibility cannot be guaranteed because portals change their UI, validation and anti-automation requirements. LinkedIn, Naukri, Indeed and career-site field patterns are covered with representative local fixtures, not authenticated live accounts. Multi-step navigation is currently manual.

## Privacy

Resume parsing runs locally with bundled PDF.js and Mammoth. No AI service, external API, analytics or remote fonts are used. The original resume file and extracted text are not stored. Only your reviewed profile is saved in `chrome.storage.local` (not browser sync). Answers to one-off questions are not persisted. Use **Delete my saved data** to remove your profile. Browser-local storage is not encrypted by this extension. Filling a form shares those filled details with that website.

Permissions: `activeTab` grants temporary access only when you open the extension; `scripting` scans and fills the selected page; `storage` saves your local profile. There are no broad host permissions.

Dependency audit currently reports moderate advisories in Mammoth's CLI dependency chain (`argparse` / `sprintf-js`). The extension imports Mammoth's browser bundle, which does not use that CLI chain. Avoid blindly applying the suggested downgrade to an obsolete Mammoth version.

## Development

Source lives in `src/`; `npm run build` generates the complete unpacked extension in `dist/`. Reload the unpacked extension after rebuilding. Unit tests cover parsing, classification and filling. Browser tests exercise the actual bundles, PDF worker, document import and DOM under the extension's CSP with a Chrome API adapter. They verify missing questions, filling, preservation of existing values, and profile deletion; they do not verify Chrome permission grants.

On Linux browser tests default to `/usr/bin/chromium`; set `CHROMIUM_PATH` to another installed Chromium binary if needed. For an unmanaged browser that allows loading unpacked extensions, `RESUME_TEST_EXTENSION=1 npm run test:browser` additionally runs the same workflow in a real extension context. That mode grants the local fixture host in a temporary test copy because headless Chromium has no clickable toolbar. The production manifest keeps `activeTab` only. The cloud machine's managed Chromium blocks installing extensions, so real extension installation and authenticated portal checks must be done in your own browser.
