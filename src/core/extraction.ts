import Papa from "papaparse";
import { cleanFields, labelKey, sensitive, type Fields } from "./model";
export interface Candidate {
  fields: Fields;
  warnings: string[];
  record: number;
}
export interface Extraction {
  candidates: Candidate[];
  warnings: string[];
}
const aliases: Record<string, string> = {
  name: "fullName",
  "full name": "fullName",
  "person name": "fullName",
  "candidate name": "fullName",
  "first name": "firstName",
  "given name": "firstName",
  "middle name": "middleName",
  "last name": "lastName",
  surname: "lastName",
  email: "email",
  "email address": "email",
  "e mail": "email",
  "e-mail": "email",
  "alternate email": "alternateEmails",
  "alternate emails": "alternateEmails",
  phone: "phone",
  "phone number": "phone",
  mobile: "phone",
  "mobile number": "phone",
  "contact number": "phone",
  "alternate phone": "alternatePhones",
  "alternate phones": "alternatePhones",
  address: "address",
  "home address": "address",
  "street address": "address",
  "residential address": "address",
  "permanent address": "permanentAddress",
  city: "city",
  town: "city",
  state: "state",
  province: "state",
  country: "country",
  zip: "postalCode",
  "zip code": "postalCode",
  "postal code": "postalCode",
  pincode: "postalCode",
  dob: "dateOfBirth",
  "date of birth": "dateOfBirth",
  "birth date": "dateOfBirth",
  gender: "gender",
  company: "currentCompany",
  "company name": "currentCompany",
  "current company": "currentCompany",
  employer: "currentCompany",
  designation: "jobTitle",
  "job title": "jobTitle",
  title: "jobTitle",
  linkedin: "linkedin",
  github: "github",
  website: "website",
  portfolio: "website",
  school: "school",
  university: "school",
  degree: "degree",
  skills: "skills",
};
export function mapColumn(label: string): string | null {
  if (!label.trim() || sensitive(label)) return null;
  const key = labelKey(
    label.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " "),
  );
  return aliases[key] || `custom:${labelKey(label)}`;
}
export function rowsToRecords(rows: unknown[][]): Extraction {
  if (rows.length > 10001)
    throw new Error(
      "A table has more than 10,000 rows. Split it before importing.",
    );
  if (rows.length < 2)
    throw new Error("A table needs a header row and at least one person row.");
  const headers = rows[0].map((v) => String(v ?? "").trim());
  if (
    !headers.some((h) =>
      ["fullName", "firstName", "email", "phone"].includes(mapColumn(h) || ""),
    )
  )
    throw new Error(
      "No person identifier columns found. Use Name, Email or Phone headers.",
    );
  if (new Set(headers.map(labelKey)).size !== headers.length)
    throw new Error(
      "Duplicate column headings are ambiguous. Rename them before importing.",
    );
  const mapped = headers.map(mapColumn).filter(Boolean);
  if (new Set(mapped).size !== mapped.length)
    throw new Error(
      "Multiple columns map to the same field. Use Alternate email or Alternate phone for additional values.",
    );
  const warnings: string[] = [];
  const candidates: Candidate[] = [];
  headers
    .filter((h) => !mapColumn(h))
    .forEach((h) => warnings.push(`Excluded sensitive column: ${h}`));
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].every((v) => !String(v ?? "").trim())) continue;
    const fields: Fields = {};
    const issues: string[] = [];
    if (headers.length > 100)
      issues.push("Only the first 100 non-sensitive fields can be stored.");
    if (rows[i].some((v) => String(v ?? "").length > 5000))
      issues.push("A long field was truncated to 5,000 characters.");
    headers.forEach((h, j) => {
      const key = mapColumn(h),
        value = String(rows[i][j] ?? "").trim();
      if (key && value)
        fields[key] =
          key === "alternateEmails" || key === "alternatePhones"
            ? value.split(/[;,]/).map((x) => x.trim())
            : value;
    });
    if (rows[i].length > headers.length)
      issues.push("Extra columns could not be assigned.");
    if (
      fields.email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(fields.email))
    )
      issues.push("Email needs verification.");
    if (
      !fields.fullName &&
      !fields.firstName &&
      !fields.email &&
      !fields.phone
    ) {
      warnings.push(`Row ${i + 1} has no person identifier and was skipped.`);
      continue;
    }
    candidates.push({
      fields: cleanFields(fields),
      warnings: issues,
      record: i,
    });
  }
  if (candidates.length > 10000)
    throw new Error(
      "Split this document into files with at most 10,000 records.",
    );
  return { candidates, warnings };
}
export function extractCSV(text: string) {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  if (result.errors.length)
    throw new Error(`CSV could not be read: ${result.errors[0].message}`);
  return rowsToRecords(result.data);
}
export function extractPeople(text: string): Extraction {
  if (!text.trim())
    throw new Error(
      "No readable text. Scanned documents need OCR; use a text-based document or enter profiles manually.",
    );
  // Delimited tables keep one row per person, rather than pooling all identifiers.
  const first = text.split(/\r?\n/).find((x) => x.trim()) || "";
  if (
    (first.includes("\t") || first.includes(",")) &&
    /name|email|phone/i.test(first)
  )
    return extractCSV(text);
  const lines = text.split(/\r?\n/);
  const candidates: Candidate[] = [];
  const warnings: string[] = [];
  let block: string[] = [];
  const finish = () => {
    if (!block.some((x) => x.trim())) {
      block = [];
      return;
    }
    const fields: Fields = {},
      issues: string[] = [];
    const rest: string[] = [];
    for (const line of block) {
      const pair = line.match(/^\s*([^:]{1,100})\s*:\s*(.+)$/);
      if (pair) {
        const key = mapColumn(pair[1]);
        if (key) {
          if (fields[key] && String(fields[key]) !== pair[2].trim())
            issues.push(
              `Multiple ${pair[1]} values: separate this record if these belong to different people.`,
            );
          else fields[key] = pair[2].trim();
        } else issues.push(`Sensitive field excluded: ${pair[1]}`);
      } else if (line.trim()) rest.push(line.trim());
    }
    const safeText = block
      .filter((line) => !sensitive(line.split(":")[0]))
      .join("\n");
    const emails = [
      ...new Set(
        safeText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [],
      ),
    ];
    const phones = [
      ...new Set(
        (safeText.match(/\+?[\d(][\d .()-]{8,}\d/g) || []).filter(
          (x) =>
            x.replace(/\D/g, "").length >= 10 &&
            x.replace(/\D/g, "").length <= 15,
        ),
      ),
    ];
    if (emails.length > 1 || phones.length > 1) {
      issues.push(
        "Multiple unassigned identifiers. No unlabelled email or phone was assigned; verify the person boundaries.",
      );
    } else {
      if (!fields.email && emails[0]) fields.email = emails[0];
      if (!fields.phone && phones[0]) fields.phone = phones[0];
    }
    if (!fields.fullName && !fields.firstName) {
      const names = rest.filter(
        (x) =>
          /^[\p{L}][\p{L} .'-]{2,60}$/u.test(x) &&
          x.split(/\s+/).length >= 2 &&
          x.split(/\s+/).length <= 5 &&
          !/resume|curriculum|engineer|developer|manager|contact|education|experience|address|company|skills|university/i.test(
            x,
          ),
      );
      if (names.length === 1) fields.fullName = names[0];
      else if (names.length > 1)
        issues.push(
          "Several possible names. Assign a name manually; no names were pooled.",
        );
    }
    if (rest.length)
      issues.push(
        "Unlabelled text was not fully mapped. Compare this record with the source document.",
      );
    if (!fields.fullName && !fields.firstName && !fields.email && !fields.phone)
      issues.push(
        "No person identifier in this block. Complete the identity before creating a profile.",
      );
    if (Object.keys(fields).length)
      candidates.push({
        fields: cleanFields(fields),
        warnings: issues,
        record: candidates.length + 1,
      });
    else
      warnings.push(
        "A text block had no safely assignable fields and was skipped.",
      );
    block = [];
  };
  for (const line of lines) {
    // Explicit Name labels and separators define boundaries. Blank lines do not
    // imply a new person because resumes often contain spaced sections.
    if (
      /^\s*(?:full |person |candidate )?name\s*:/i.test(line) &&
      block.some((x) => /^\s*(?:full |person |candidate )?name\s*:/i.test(x))
    )
      finish();
    if (
      /^\s*(?:---+|===+|person\s+\d+|record\s+\d+)\s*$/i.test(line) ||
      line === "\f"
    ) {
      finish();
      continue;
    }
    block.push(line);
  }
  finish();
  if (!candidates.length)
    throw new Error(
      "No safely separable records found. Use labelled person blocks or a CSV with one person per row.",
    );
  warnings.push(
    "Review extracted records before saving. Free-form documents do not guarantee person separation; unidentified text is never assigned silently.",
  );
  return { candidates, warnings };
}
export interface IntelligenceService {
  extract(text: string): Promise<Extraction>;
}
// Offline implementation; a model provider can be added behind this interface.
export class LocalIntelligence implements IntelligenceService {
  async extract(text: string) {
    return extractPeople(text);
  }
}
