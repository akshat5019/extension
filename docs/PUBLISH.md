# Publish to Chrome Web Store

Personal Assist 2.0 has not been uploaded or submitted. This workspace has no authenticated Chrome Web Store developer-account access.

1. Open https://chrome.google.com/webstore/devconsole and sign in to your publisher account. Register as a developer if required.
2. Create a new item and upload `resume-assist.zip`. Its root contains the Manifest V3 package, bundled dependencies and extension icons.
3. Use `store-listing.md` for the listing and permission descriptions. Add your publisher support/contact details.
4. Add your contact details to `privacy-policy.md`, host the completed policy at a public HTTPS URL, and enter that URL in the store dashboard. Complete the store's current privacy/data-use questionnaire using the actual behavior described in the policy.
5. Use `store-assets/profile.png`, `store-assets/missing-answers.png`, `store-assets/icon-128.png` as listing assets. The screenshots render the actual built UI with imported sample profiles and adapted Chrome APIs in the cloud; they do not represent verified live portal applications. Replace them if your tested product behavior differs.
6. Install the unpacked package in your own unmanaged Chrome browser and verify the flow on the portals you claim to support. Multi-step Next/Review, custom controls and CAPTCHA can require manual handling. Do not advertise universal compatibility.
7. Review the completed listing and submit it for Chrome Web Store review. The store controls acceptance and publication timing; submitting does not mean it is already public.

The cloud environment's Publish action saves its development snapshot; it does not publish a browser extension to Chrome Web Store.
