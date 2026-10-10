import { classifyField, describeField } from "../forms.js";
import { labelKey, sensitive, display, personName, type Fields } from "./model";
import { mapColumn } from "./extraction";
export interface FormField {
  id: string;
  label: string;
  key: string | null;
  type: string;
  required: boolean;
  current: string;
  valid: boolean;
  options?: { value: string; label: string }[];
  reason?: string;
}
export interface FieldMapper {
  key(label: string, autocomplete?: string, type?: string): string | null;
  value(fields: Fields, field: FormField, includePersonal?: boolean): string;
}
export class LocalFieldMapper implements FieldMapper {
  key(label: string, autocomplete = "", type = "") {
    if (sensitive(label)) return null;
    const exact = mapColumn(label);
    if (exact === "alternateEmails" || exact === "alternatePhones")
      return exact;
    const usual = classifyField(label, autocomplete, type);
    if (usual) return usual;
    const mapped = mapColumn(label);
    if (
      mapped === "dateOfBirth" ||
      mapped === "gender" ||
      mapped === "permanentAddress" ||
      mapped === "middleName"
    )
      return mapped;
    return mapped?.startsWith("custom:") ? `custom:${labelKey(label)}` : null;
  }
  value(fields: Fields, field: FormField, includePersonal = false) {
    if (!field.key || field.reason || sensitive(field.label)) return "";
    if (["dateOfBirth", "gender"].includes(field.key) && !includePersonal)
      return "";
    if (
      field.key === "fullName" &&
      [
        fields.fullName,
        fields.firstName,
        fields.middleName,
        fields.lastName,
      ].some(Array.isArray)
    )
      return "";
    if (field.key === "fullName")
      return personName(fields) === "Unnamed profile" ? "" : personName(fields);
    const value = fields[field.key]; // Alternate values require explicit review.
    return Array.isArray(value) ? "" : display(value);
  }
}
export const mapper = new LocalFieldMapper();
export function describe(
  element: HTMLElement & { type?: string; autocomplete?: string },
) {
  const base = describeField(element);
  const legend = ["radio", "checkbox"].includes(element.type || "")
    ? element.closest("fieldset")?.querySelector("legend")?.textContent?.trim()
    : undefined;
  const label = legend || base.label;
  return {
    label,
    key: mapper.key(label, element.autocomplete || "", element.type || ""),
  };
}
