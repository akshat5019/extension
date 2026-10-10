import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  classifyField,
  describeField,
  writeField,
  profileValue,
} from "../src/forms.js";
import { getPortalAdapter } from "../src/site-adapters.js";

test("recognizes representative Naukri, LinkedIn and career-site fields", () => {
  for (const [label, expected] of [
    ["First name", "firstName"],
    ["lastName", "lastName"],
    ["Email address", "email"],
    ["Mobile number", "phone"],
    ["Current company", "currentCompany"],
    ["LinkedIn profile", "linkedin"],
    ["Current job title", "jobTitle"],
    ["Postal code", "postalCode"],
    ["University", "school"],
  ])
    assert.equal(classifyField(label), expected, label);
  assert.equal(
    classifyField("Applicant", "section-personal given-name"),
    "firstName",
  );
  assert.equal(
    profileValue({ firstName: "Akshat", lastName: "Sharma" }, "fullName"),
    "Akshat Sharma",
  );
});
test("never infers legal, salary, demographic, consent or credential questions", () => {
  for (const label of [
    "Email verification code",
    "Are you authorized to work in this country?",
    "Expected salary",
    "Notice period",
    "Years of experience",
    "Gender",
    "Agree to terms",
    "Passport number",
    "Birth date",
    "Sponsorship required?",
    "Why this company?",
  ])
    assert.equal(classifyField(label, "email", "email"), null, label);
});
test("visible labels beat misleading machine names and ARIA labels are recognized", () => {
  const { window } = new JSDOM(
    '<label for="email">Expected salary</label><input id="email" name="email"><span id="label">First name</span><input id="name" aria-labelledby="label">',
  );
  assert.equal(
    describeField(window.document.getElementById("email")).key,
    null,
  );
  assert.equal(
    describeField(window.document.getElementById("name")).key,
    "firstName",
  );
});
test("fills inputs with native events and matches select options exactly", () => {
  const { window } = new JSDOM(
    '<input><select><option value="">Select</option><option value="IN">India</option><option disabled value="US">USA</option></select><input type="checkbox"><input type="file">',
  );
  const [input, select, checkbox, file] =
    window.document.querySelectorAll("input,select");
  const events = [];
  input.addEventListener("input", () => events.push("input"));
  input.addEventListener("change", () => events.push("change"));
  assert.equal(writeField(input, "Akshat"), true);
  assert.deepEqual(events, ["input", "change"]);
  assert.equal(writeField(select, "india"), true);
  assert.equal(select.value, "IN");
  assert.equal(writeField(select, "USA"), false);
  assert.equal(writeField(select, "Ind"), false);
  assert.equal(writeField(checkbox, "yes"), false);
  assert.equal(writeField(file, "resume.pdf"), false);
});

test("matches adjacent labels on common job-platform fixtures and rejects lookalike domains", () => {
  const cases = [
    [
      "https://company.myworkdayjobs.com/en-US/careers",
      "Workday",
      'data-automation-id="formLabel"',
    ],
    [
      "https://careers.example.com/en/sites/CX_1/jobs/",
      "Oracle Recruiting / Taleo",
      'class="input-row__label"',
    ],
    [
      "https://boards.greenhouse.io/company",
      "Greenhouse",
      'class="application--label"',
    ],
    ["https://jobs.lever.co/company", "Lever", 'class="application-label"'],
    [
      "https://careers-company.icims.com/jobs",
      "iCIMS",
      'class="iCIMS_FieldLabel"',
    ],
    [
      "https://careers.smartrecruiters.com/company",
      "SmartRecruiters",
      'class="field-label"',
    ],
    [
      "https://company.successfactors.com/jobs",
      "SuccessFactors",
      'class="fieldLabel"',
    ],
    [
      "https://www.linkedin.com/jobs/",
      "LinkedIn",
      'class="fb-dash-form-element__label"',
    ],
    ["https://www.naukri.com/", "Naukri", 'class="formLabel"'],
    ["https://www.indeed.com/", "Indeed", 'data-testid="field-label"'],
    [
      "https://company.example/careers",
      "Standard website forms",
      'class="form-label"',
    ],
  ];
  for (const [url, adapter, labelAttribute] of cases) {
    const { window } = new JSDOM(
      `<div><span ${labelAttribute}>First name *</span><div><input id="opaque-input-1" placeholder="Enter"></div></div><div><span ${labelAttribute}>Family Name</span><input id="opaque-input-2"></div>`,
      { url },
    );
    assert.equal(getPortalAdapter(window.document).name, adapter, url);
    assert.equal(
      describeField(window.document.getElementById("opaque-input-1")).key,
      "firstName",
      url,
    );
    assert.equal(
      describeField(window.document.getElementById("opaque-input-2")).key,
      "lastName",
      url,
    );
  }
  const fake = new JSDOM("<input>", {
    url: "https://linkedin.com.other.example",
  });
  assert.equal(
    getPortalAdapter(fake.window.document).name,
    "Standard website forms",
  );
});

test("uses exact ATS metadata and keeps visible field semantics ahead of identifiers and autocomplete", () => {
  const { window } = new JSDOM(
    '<input id="one" data-automation-id="legalNameSection_firstName" placeholder="Enter"><input id="two" data-automation-id="legalNameSection_lastName"><label>Expected salary<input id="firstName" autocomplete="given-name"></label><label>Family Name<input id="opaque" autocomplete="given-name"></label><input id="unlabelled" autocomplete="section-personal given-name"><label for="reference">Referee full name</label><input id="reference" data-field="fullName" autocomplete="name"><div><span class="form-label">First name</span><input id="ambiguous-a"><input id="ambiguous-b"></div>',
  );
  for (const [id, key] of [
    ["one", "firstName"],
    ["two", "lastName"],
    ["firstName", null],
    ["opaque", "lastName"],
    ["unlabelled", "firstName"],
    ["reference", null],
    ["ambiguous-a", null],
    ["ambiguous-b", null],
  ])
    assert.equal(
      describeField(window.document.getElementById(id)).key,
      key,
      id,
    );
  assert.equal(classifyField("First job preference"), null);
  assert.equal(classifyField("Manager first name", "given-name"), null);
  assert.equal(classifyField("Emergency contact phone", "tel", "tel"), null);
});

test("resolves shadow-root ARIA names and sends events across the component boundary", () => {
  const { window } = new JSDOM(
    '<div id="host"></div><span id="same-id">Expected salary</span>',
  );
  const host = window.document.getElementById("host");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    '<span id="same-id">First name</span><input aria-labelledby="same-id">';
  const input = root.querySelector("input");
  assert.equal(describeField(input).key, "firstName");
  let events = 0;
  host.addEventListener("input", () => events++);
  assert.equal(writeField(input, "Akshat"), true);
  assert.equal(events, 1);
});
