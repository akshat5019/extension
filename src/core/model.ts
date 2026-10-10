export type Fields = Record<string, string | string[]>;
export interface Source {
  documentId?: string;
  name: string;
  at: string;
  fields: string[];
}
export interface Person {
  id: string;
  schemaVersion: 1;
  revision: number;
  fields: Fields;
  status: "review" | "verified";
  sources: Source[];
  createdAt: string;
  updatedAt: string;
  searchTokens: string[];
}
export interface DocumentRecord {
  id: string;
  name: string;
  fingerprint: string;
  importedAt: string;
  count: number;
  warnings: string[];
}
export const BASE_FIELDS = [
  "fullName",
  "firstName",
  "middleName",
  "lastName",
  "email",
  "alternateEmails",
  "phone",
  "alternatePhones",
  "dateOfBirth",
  "gender",
  "address",
  "permanentAddress",
  "city",
  "state",
  "postalCode",
  "country",
  "currentCompany",
  "jobTitle",
  "linkedin",
  "github",
  "website",
  "school",
  "degree",
  "skills",
];
export const LABELS: Record<string, string> = {
  fullName: "Full name",
  firstName: "First name",
  middleName: "Middle name",
  lastName: "Last name",
  email: "Email",
  alternateEmails: "Alternate emails",
  phone: "Phone",
  alternatePhones: "Alternate phones",
  dateOfBirth: "Date of birth",
  gender: "Gender",
  address: "Residential address",
  permanentAddress: "Permanent address",
  postalCode: "Postal code",
  currentCompany: "Company",
  jobTitle: "Job title",
};
export const normal = (v: unknown) =>
  String(v ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
export const labelKey = (v: string) =>
  normal(v)
    .replace(/\(required\)|\*/g, "")
    .trim();
export const phoneKey = (v: unknown) => String(v ?? "").replace(/\D/g, "");
export const display = (v: unknown) =>
  Array.isArray(v) ? v.join("; ") : String(v ?? "");
export const personName = (f: Fields) =>
  display(f.fullName) ||
  [f.firstName, f.middleName, f.lastName].filter(Boolean).join(" ") ||
  "Unnamed profile";
export function sensitive(label: string) {
  label = label.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
  return /password|passcode|captcha|one[ -]?time|\botp\b|verification code|social security|\bssn\b|passport|national (?:id|identity)|aadhaar|aadhar|pan (?:card|number)|bank|account number|credit card|debit card|card number|\bcvv\b|routing number|authentication|secret|token|consent|agree to|terms and conditions|signature/i.test(
    label,
  );
}
export function cleanFields(raw: unknown): Fields {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Profile fields must be an object.");
  const result: Fields = Object.create(null);
  for (const [key, value] of Object.entries(raw)) {
    if (
      !key ||
      key.length > 150 ||
      ["__proto__", "prototype", "constructor", "searchTokens"].includes(key) ||
      sensitive(key)
    )
      continue;
    const values = (Array.isArray(value) ? value : [value])
      .filter((v) => typeof v === "string" || typeof v === "number")
      .map((v) => String(v).trim().slice(0, 5000))
      .filter(Boolean)
      .slice(0, 20);
    if (values.length) result[key] = Array.isArray(value) ? values : values[0];
    if (Object.keys(result).length >= 100) break;
  }
  return result;
}
export function searchable(fields: Fields) {
  const texts = Object.values(fields).map(display).map(normal);
  const phones = [fields.phone, fields.alternatePhones]
    .flat()
    .filter(Boolean)
    .map(phoneKey);
  return [...texts, ...phones].join(" ").slice(0, 5000);
}
export function tokens(fields: Fields) {
  const text = searchable(fields),
    values = new Set<string>();
  for (let size = 1; size <= 3; size++)
    for (let i = 0; i <= text.length - size; i++)
      values.add(text.slice(i, i + size));
  return [...values];
}
export function identityMatches(a: Fields, b: Fields) {
  const emails = (f: Fields) =>
    [f.email, f.alternateEmails].flat().filter(Boolean).map(normal);
  const phones = (f: Fields) =>
    [f.phone, f.alternatePhones]
      .flat()
      .filter(Boolean)
      .map(phoneKey)
      .filter((v) => v.length >= 7);
  const reasons: string[] = [];
  if (emails(a).some((x) => emails(b).includes(x))) reasons.push("same email");
  if (
    phones(a).some((x) =>
      phones(b).some(
        (y) =>
          x === y ||
          (x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10)),
      ),
    )
  )
    reasons.push("same phone");
  if (
    normal(personName(a)) !== "unnamed profile" &&
    normal(personName(a)) === normal(personName(b))
  )
    reasons.push("same name — identity uncertain");
  return reasons;
}
export function conflicts(old: Fields, next: Fields) {
  return Object.keys(next).filter(
    (k) => old[k] && normal(display(old[k])) !== normal(display(next[k])),
  );
}
export type ConflictChoice = "replace" | "both" | "keep";
export function combine(
  old: Fields,
  next: Fields,
  choices: Record<string, ConflictChoice>,
): Fields {
  const out = { ...old };
  for (const [key, value] of Object.entries(next)) {
    if (!old[key] || normal(display(old[key])) === normal(display(value)))
      out[key] = value;
    else {
      if (!choices[key])
        throw new Error(`Choose how to resolve ${LABELS[key] || key}.`);
      if (choices[key] === "replace") out[key] = value;
      if (choices[key] === "both")
        out[key] = [...new Set([old[key], value].flat())];
    }
  }
  return cleanFields(out);
}
