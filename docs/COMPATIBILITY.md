# Job portal compatibility

Personal Assist works through the form DOM, without job-provider API accounts. The selected profile is used only after **Scan form** and **Fill form**. This version supports a broad range of standard forms; it does not guarantee every portal or control.

| Portal/platform | Adapter evidence covered by tests |
| --- | --- |
| LinkedIn | Adjacent Easy Apply labels and standard input semantics |
| Naukri | Form label containers and standard name/contact inputs |
| Indeed | Field-label metadata and standard controls |
| Workday | Form-label metadata; exact legal-name and address identifiers |
| Oracle Recruiting / Taleo | Oracle career-site paths and label containers |
| Greenhouse | Application/field labels and conventional identifiers |
| Lever | Application-question labels |
| iCIMS | Native field labels and profile identifiers |
| SmartRecruiters | Native field labels and test/field attributes |
| SuccessFactors | Field-label containers |
| Other company career sites | Associated labels, ARIA, bounded adjacent labels, placeholders, autocomplete and exact identifiers |

Tests use representative fixtures for these conventions, including 11 site layouts. They do not log into providers or verify current authenticated production layouts. Platforms can change their markup, and company-specific configurations may need additional adapters.

## Supported form structures

Native inputs/textareas/selects, radio groups and non-consent checkboxes are scanned in the top-level document, open shadow roots and accessible same-origin/inherited-origin iframes. Events use each control's own document and cross open component boundaries. Manual edits can be reviewed and saved to the selected profile; undo preserves subsequent user changes. Radio groups remain separate across document/shadow roots.

Labels that are explicitly associated or accessible take precedence. An adjacent label is used only when its bounded container contains one control and has one unambiguous label. Exact platform identifiers can supply a missing label; misleading visible labels are never replaced by metadata. Names are split from the selected profile's full name when needed, without guessing missing surnames or mixing profiles. Referee/emergency-contact fields remain manual unless their exact custom values were reviewed and stored explicitly.

## When names are missing

1. Verify the saved profile's **Full name** or first/last components in **People**. If import could not identify a name, choose the correct extracted suggestion and review the record before saving.
2. On a job application, attach the resume file separately if required, continue to the personal-details step, then scan again. File-upload controls cannot receive a person's name as their value.
3. Select the correct saved person and click **Scan form**, then **Fill form**. Existing values are preserved. Undo before changing people.
4. If a step, label or embedded URL changes, scan that step again. The extension rejects stale snapshots.
5. Protected/cross-origin/sandboxed frames need manual entry, or open the embedded application directly in a normal website tab and scan there. Granting a hostname permission does not remove frame/security restrictions in this version.
6. Custom dropdowns need an explicit option selection on the page. Closed shadow components, inaccessible widgets, CAPTCHA and protected Chrome pages are not automated. The popup explains unavailable controls rather than putting plain text into an unselected dropdown.
7. If a supported name input is still missed, provide the page URL and a screenshot of the field/label. For resume extraction, provide the document itself; a screenshot of an empty name box cannot establish its PDF text layout.

To add an adapter, update `src/site-adapters.js` with bounded label selectors or exact field identifiers and add a fixture test. Keep generic fallback, selected-profile binding, label precedence, field-snapshot checks, local data isolation, no-overwrite behavior and manual submission intact. Never add broad text-substring or arbitrary click/submit rules to identify a person's name.
