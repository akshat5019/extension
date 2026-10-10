# Resume Assist

A Chrome / Edge extension for Naukri, LinkedIn, Indeed, and company career sites. Enable it on a portal once, then attach your resume directly to the application. Resume Assist reads that attachment locally and fills matching empty fields without a separate upload in the extension. Missing answers remain manual, with optional answer memory and automatic submission.

## Build and install

For local testing without build tools, [download the ready-to-install extension ZIP](https://github.com/akshat5019/extension/raw/refs/heads/main/downloads/resume-assist.zip), extract it, then choose the extracted folder containing `manifest.json` using **Load unpacked** in `chrome://extensions` with **Developer mode** enabled. This package is for local installation, not a Chrome Web Store listing.

Requires Node.js 22 or newer and Chrome/Edge 120 or newer.

```sh
npm ci
npm run build
npm test
npm run test:browser
```

Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**, click **Load unpacked**, and select the generated `dist` folder.

1. Open a job application on your portal. Open Resume Assist, click **Enable on this portal**, and grant Chrome's access request for that site's hostname. This persists for later pages on that hostname. Enable separately for another portal or a redirected career-site hostname. **Disable on this portal** revokes it.
2. Attach your **text-based PDF, DOCX or TXT** resume directly to the portal's resume/CV upload field (up to 10 MB and 50 PDF pages). The original portal upload proceeds normally. Resume Assist reads it locally in a hidden extension document and fills matching empty fields, including fields that appear within 30 seconds on the same form. It preserves existing answers. A status panel shows missing details. No separate extension upload is needed. Image-only scans require manual entry; OCR is not included.
3. Review the filled details. The extracted profile is a temporary browser-session draft for this tab and URL. Open Resume Assist to edit it and optionally click **Save profile** to retain it. Extraction is conservative: ambiguous details remain blank, and your previously saved profile can supply additional known details. The extension helps the portal's form; it does not change the portal's own resume parser.
4. Open **Fill application → Start autofill** to show missing questions. Enter answers and click **Fill missing answers & resume**, or complete them directly on the portal. **Remember answers I enter for future applications** is enabled by default; uncheck it for one-off answers. For details typed on the portal after scanning, click **Save answers entered on page**. Consent choices remain manual. To submit automatically, explicitly check **Submit this application automatically when complete** before starting/resuming autofill. Optional questions also pause submission unless you explicitly choose **Leave unanswered optional fields blank**.
5. With automatic submission enabled, a status panel stays on the portal even after the popup closes. It waits for complete, valid answers and a unique enabled final Submit button, then shows a **3-second cancellable countdown**. Edits restart the countdown. It clicks Submit at most once; an attempted click is not proof that the portal accepted the application. Check for the portal's confirmation. Cancel from the page panel or the extension popup at any time.
6. **Use Next / Review yourself and restart autofill on each new step.** The extension never guesses that a Next button is Submit. A URL change, removed form, or 10-minute timeout stops the current automatic-submission session. Selecting a new resume stops any prior submission monitor; approve submission again for the new resume.

## Coverage and limits

The extension uses visible labels, ARIA labels, names, and autocomplete attributes, rather than fixed portal selectors. Native text inputs, textareas and single-select dropdowns are supported; React forms receive native input/change events. Existing values are preserved. Salary, notice period, work authorization, sponsorship, demographic information and consent are never inferred from your resume. Questions not found in your saved profile are shown for explicit answers.

Direct resume detection supports user-selected files in native file inputs identifiable by a resume/CV label, ARIA label, nearby upload text, field name or filename. Cover letters/certificates are ignored. Custom upload widgets that do not expose a native file selection/change, closed shadow DOM, embedded cross-origin upload frames, and resumes already stored on the portal cannot be read automatically. Reattach the file using a native resume upload or enter your profile manually. Open an embedded application directly where possible. Checkboxes, radio buttons and custom dropdowns remain manual. Passwords are excluded from autofill. Automatic submission stops for detected CAPTCHA, custom/embedded controls, account fields, validation errors, and ambiguous submit buttons.

Detection is general across job platforms; it does not depend on a fixed list of allowed portals. Universal compatibility cannot be guaranteed because portals change their UI, validation and anti-automation requirements. LinkedIn, Naukri, Indeed and career-site field patterns are covered with representative local fixtures, not authenticated live accounts. Multi-step navigation is currently manual.

## Privacy

Resume parsing runs locally with bundled PDF.js and Mammoth. No AI service, external API, analytics or remote fonts are used. Raw file bytes are passed only between the page content script and local extension parser in memory; the original file and extracted full text are not stored. Detected profile details plus the application URL are temporarily kept in `chrome.storage.session` for the tab, removed when its tab closes or the browser session ends, and consumed when you save the profile/answers. Your reviewed profile and answers you choose to remember are saved in `chrome.storage.local` (not browser sync). Remembered basic profile details update your profile and can autofill in future. Other answers are scoped to the same website and exact question meaning/options; they appear as suggestions you review before filling, including salary and work authorization. Different wording or websites require a fresh answer. Passwords, verification codes, financial/identity numbers, attachments and consent controls are not remembered. Up to 100 remembered questions are retained; older entries are removed when that limit is reached.

Edit or forget remembered answers under **Your profile → Remembered application answers**. Use **Delete my saved data** to remove both your profile and remembered answers. Uncheck Remember answers when filling one-off answers. Browser-local storage is not encrypted by this extension. Filling a form shares those filled details with that website.

Permissions: `activeTab` grants temporary access when you open the extension; `scripting` scans/fills and registers upload detection on enabled portals; `storage` holds local saved details and temporary drafts; `offscreen` runs bundled document parsers locally without a visible tab. Optional HTTP/HTTPS host permissions are declared so you can enable any supported portal, but access is requested only for the specific hostname you choose. No persistent website access is granted by default.

Dependency audit currently reports moderate advisories in Mammoth's CLI dependency chain (`argparse` / `sprintf-js`). The extension imports Mammoth's browser bundle, which does not use that CLI chain. Avoid blindly applying the suggested downgrade to an obsolete Mammoth version.

## Development

Source lives in `src/`; `npm run build` generates the complete unpacked extension in `dist/`. Reload the extension and portal page after rebuilding. Unit tests cover parsing, field matching, portal scoping, upload detection and remembered answers. Browser tests exercise actual popup/content/background/parser bundles, the PDF worker and DOM under the extension's CSP with a Chrome API adapter. They verify direct portal uploads, original attachment preservation, missing questions, filling, memory and deletion; they do not verify real Chrome permission prompts or authenticated portal accounts.

On Linux browser tests default to `/usr/bin/chromium`; set `CHROMIUM_PATH` to another installed Chromium binary if needed. For an unmanaged browser that allows loading unpacked extensions, `RESUME_TEST_EXTENSION=1 npm run test:browser` runs the same workflow in a real extension context. That mode grants its local fixture host in a temporary test copy because headless Chromium has no clickable toolbar. Permission denial/revocation behavior is tested in adapter mode; a real host-permission override changes that environment. Production permissions remain optional and per-portal. The cloud's managed Chromium blocks installing extensions, so native permission prompts, real offscreen lifecycle and authenticated portal checks must be verified in your own browser.
