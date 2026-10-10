import { labelText, nearbyPortalLabel, machineLabel } from "./site-adapters.js";
import { collectFormTree } from "./form-tree.js";
const normalize = (text) =>
  String(text || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function classifyField(text, autocomplete = "", type = "") {
  const label = normalize(text)
    .replace(/\(required\)|\*|\brequired\s*$/g, "")
    .trim();
  if (
    /password|captcha|one time|verification code|social security|passport|bank|credit card|date of birth|birth date/.test(
      label,
    )
  )
    return null;
  // Questions with legal/personal implications always require explicit answers.
  if (
    /authorized|authorised|authorization|authorisation|sponsor|visa|salary|compensation|gender|race|ethnic|disabilit|veteran|pronoun|relocat|notice period|start date|years|experience|cover letter|why |agree|consent|citizen/.test(
      label,
    )
  )
    return null;
  if (
    /\b(referee|reference|emergency|spouse|father|mother|guardian|recruiter|supervisor|beneficiary)\b|(?:manager|employer|company)\s+(?:first|last|full|given|family|middle)\s*name/.test(
      label,
    )
  )
    return null;
  const auto = {
    "given-name": "firstName",
    "additional-name": "middleName",
    "family-name": "lastName",
    name: "fullName",
    email: "email",
    tel: "phone",
    "street-address": "address",
    "address-line1": "address",
    "address-level2": "city",
    "address-level1": "state",
    "postal-code": "postalCode",
    "country-name": "country",
    country: "country",
    organization: "currentCompany",
    "organization-title": "jobTitle",
  };
  const token = autocomplete.split(/\s+/).at(-1);
  if (label === "middle" && token === "additional-name") return "middleName";
  const patterns = [
    ["firstName", /\b(first|given)\s*names?\b|^forename$|^(?:legal )?first$/],
    ["lastName", /\b(last|family|sur)\s*names?\b|^(?:legal )?last$/],
    ["middleName", /\bmiddle\s*name\b/],
    [
      "fullName",
      /\b(full name|your name|legal name|candidate name|applicant name|person name)\b|^name$/,
    ],
    ["email", /\be ?mail\b/],
    ["phone", /\b(phone|mobile|telephone|contact number)\b/],
    ["linkedin", /linked\s?in/],
    ["github", /github/],
    ["website", /\b(website|portfolio|personal url)\b/],
    ["postalCode", /\b(zip|postal|pin code|pincode)\b/],
    ["city", /\b(city|town)\b/],
    ["state", /\b(state|province|region)\b/],
    ["country", /\bcountry\b/],
    [
      "address",
      /\b(street address|home address|residential address|address line 1|address1)\b|^address$/,
    ],
    [
      "currentCompany",
      /\b(current company|current employer|company name|employer name)\b/,
    ],
    [
      "jobTitle",
      /\b(current title|current job title|job title|position title)\b/,
    ],
    ["school", /\b(school|university|college|institution)\b/],
    ["degree", /\bdegree\b/],
    ["skills", /\bskills\b/],
  ];
  for (const [key, regex] of patterns) if (regex.test(label)) return key;
  if (
    auto[token] &&
    (!label ||
      label === normalize(autocomplete) ||
      /^(?:applicant|name|contact|enter(?: your)?(?: details)?|type here|please select|select|choose)(?:\s*\.\.\.)?$/.test(
        label,
      ))
  )
    return auto[token];
  if (type === "email") return "email";
  if (type === "tel") return "phone";
  return null;
}

export function profileValue(profile, key) {
  if (key === "fullName")
    return [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  return profile[key] || "";
}

export function describeField(element) {
  const root = element.getRootNode();
  const labels = Array.from(element.labels || [])
    .map(labelText)
    .filter(Boolean);
  const ariaLabels = (element.getAttribute("aria-labelledby") || "")
    .split(/\s+/)
    .map((id) => root.getElementById?.(id)?.textContent || "")
    .filter(Boolean);
  const visibleLabel =
    labels.join(" ") ||
    ariaLabels.join(" ") ||
    element.getAttribute("aria-label") ||
    nearbyPortalLabel(element);
  const placeholder = element.getAttribute("placeholder") || "";
  const genericPlaceholder =
    /^(?:enter(?: (?:here|text|value|your details))?|type here|please (?:enter|select)|select|choose)(?:\s*\.\.\.)?$/i.test(
      placeholder.trim(),
    );
  const fallback =
    machineLabel(element) ||
    element.getAttribute("autocomplete") ||
    element.name ||
    element.id ||
    element.type;
  const evidence =
    visibleLabel || (!genericPlaceholder && placeholder) || fallback;
  const label = String(evidence || "Unlabelled field")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return {
    label,
    key: classifyField(evidence, element.autocomplete || "", element.type),
  };
}

export function collectFields(doc) {
  return collectFormTree(doc).fields;
}

export function fieldValue(element) {
  if (["radio", "checkbox"].includes(element.type))
    return element.checked ? element.value || "checked" : "";
  if (element.type === "file") return element.files?.length ? "Attached" : "";
  return element.value || "";
}

export function isRequired(element) {
  return (
    element.required ||
    element.getAttribute("aria-required") === "true" ||
    /\*|\(required\)/i.test(describeField(element).label)
  );
}

export function writeField(element, value) {
  if (
    !value ||
    ["file", "checkbox", "radio", "password"].includes(element.type)
  )
    return false;
  if (element.tagName === "SELECT") {
    if (element.multiple) return false;
    const match = Array.from(element.options).find(
      (option) =>
        !option.disabled &&
        option.value &&
        (normalize(option.value) === normalize(value) ||
          normalize(option.textContent) === normalize(value)),
    );
    if (!match) return false;
    value = match.value;
  }
  const win = element.ownerDocument.defaultView;
  const prototype =
    element.tagName === "SELECT"
      ? win.HTMLSelectElement.prototype
      : element.tagName === "TEXTAREA"
        ? win.HTMLTextAreaElement.prototype
        : win.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
  element.dispatchEvent(
    new win.Event("input", { bubbles: true, composed: true }),
  );
  element.dispatchEvent(
    new win.Event("change", { bubbles: true, composed: true }),
  );
  return element.value === value;
}
