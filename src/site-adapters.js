// Adapters provide field evidence only. They never click, submit, request data,
// grant permissions, or change the currently selected person.
const adapters = [
  {
    name: "Workday",
    hosts: ["myworkdayjobs.com", "workday.com"],
    labels: '[data-automation-id="formLabel"]',
  },
  {
    name: "Oracle Recruiting / Taleo",
    hosts: ["oraclecloud.com", "taleo.net"],
    labels: ".oj-label, .input-row__label, .form-element-label",
  },
  {
    name: "Greenhouse",
    hosts: ["greenhouse.io"],
    labels: ".application--label, .field-label",
  },
  {
    name: "Lever",
    hosts: ["lever.co"],
    labels: ".application-label, .application-question-label",
  },
  {
    name: "iCIMS",
    hosts: ["icims.com"],
    labels: ".iCIMS_FieldLabel, .iCIMS_Label",
  },
  {
    name: "SmartRecruiters",
    hosts: ["smartrecruiters.com"],
    labels: ".field-label",
  },
  {
    name: "SuccessFactors",
    hosts: ["successfactors.com", "successfactors.eu"],
    labels: ".fieldLabel",
  },
  {
    name: "LinkedIn",
    hosts: ["linkedin.com"],
    labels: ".fb-dash-form-element__label, .artdeco-text-input--label",
  },
  { name: "Naukri", hosts: ["naukri.com"], labels: ".formLabel, .form-label" },
  {
    name: "Indeed",
    hosts: ["indeed.com"],
    labels: '[data-testid="field-label"]',
  },
];
const generic = { name: "Standard website forms", labels: "" };
const commonLabels =
  'label, legend, .field-label, .form-label, .control-label, .label, [data-automation-id="formLabel"]';
const keys = {
  fullname: "Full name",
  name: "Full name",
  candidatename: "Full name",
  applicantname: "Full name",
  firstname: "First name",
  givenname: "First name",
  legalfirstname: "First name",
  fname: "First name",
  lastname: "Last name",
  familyname: "Last name",
  surname: "Last name",
  legallastname: "Last name",
  lname: "Last name",
  middlename: "Middle name",
  email: "Email",
  emailaddress: "Email",
  phone: "Phone",
  phonenumber: "Phone",
  mobile: "Phone",
  mobilenumber: "Phone",
  address: "Address",
  addressline1: "Address",
  streetaddress: "Address",
  city: "City",
  state: "State",
  country: "Country",
  postalcode: "Postal code",
  zipcode: "Postal code",
  linkedin: "LinkedIn",
  linkedinurl: "LinkedIn",
  github: "GitHub",
  website: "Website",
};
const platformKeys = {
  legalnamesectionfirstname: "First name",
  legalnamesectionlastname: "Last name",
  legalnamesectionmiddlename: "Middle name",
  addresssectionaddressline1: "Address",
  addresssectioncity: "City",
  addresssectionstate: "State",
  addresssectionpostalcode: "Postal code",
  candidatefirstname: "First name",
  candidatelastname: "Last name",
  candidatefullname: "Full name",
  candidateemail: "Email",
  candidatephonenumber: "Phone",
  personprofilefieldsfirstname: "First name",
  personprofilefieldslastname: "Last name",
  personprofilefieldsemail: "Email",
  personprofilefieldsphone: "Phone",
};
export function getPortalAdapter(doc) {
  const hostname = doc.location?.hostname || "";
  const match = adapters.find((adapter) =>
    adapter.hosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    ),
  );
  if (match) return match;
  if (
    doc.querySelector(
      '[data-automation-id="legalNameSection_firstName"], [data-automation-id="applyFlowPage"]',
    )
  )
    return adapters[0];
  if (
    /\/sites\/CX_\d+\//i.test(doc.location?.pathname || "") ||
    doc.querySelector("oj-input-text, .oj-form-control")
  )
    return adapters[1];
  return generic;
}
export function labelText(element) {
  const clone = element.cloneNode(true);
  clone
    .querySelectorAll('input,select,textarea,button,[aria-hidden="true"]')
    .forEach((node) => node.remove());
  return (clone.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
}
export function nearbyPortalLabel(element) {
  const adapter = getPortalAdapter(element.ownerDocument);
  const selector = [commonLabels, adapter.labels].filter(Boolean).join(",");
  let scope = element.parentElement;
  for (
    let depth = 0;
    scope && depth < 4;
    depth++, scope = scope.parentElement
  ) {
    // An unassociated label may only describe one control, never a whole section.
    if (scope.querySelectorAll("input,select,textarea").length !== 1) break;
    const labels = [...scope.querySelectorAll(selector)]
      .filter(
        (label) =>
          !label.hasAttribute("for") ||
          label.getAttribute("for") === element.id,
      )
      .map(labelText)
      .filter(Boolean);
    const unique = [...new Set(labels)];
    if (unique.length === 1) return unique[0];
    if (unique.length > 1) return "";
  }
  return "";
}
export function machineLabel(element) {
  // Match exact identifiers; substrings like managerFirstName are not a person field.
  const candidates = [element, element.parentElement];
  for (const node of candidates.filter(Boolean)) {
    const attributes =
      node === element
        ? [
            "data-automation-id",
            "data-testid",
            "data-test",
            "data-field",
            "name",
            "id",
          ]
        : ["data-automation-id", "data-field"];
    for (const attribute of attributes) {
      const value = (node.getAttribute(attribute) || "")
        .replace(/[^a-z0-9]/gi, "")
        .toLowerCase();
      if (keys[value] || platformKeys[value])
        return keys[value] || platformKeys[value];
    }
  }
  return "";
}
