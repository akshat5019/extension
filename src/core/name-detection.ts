import { sensitive } from "./model";

// These heuristics are suggestions for import review, not proof of identity.
export function isPossiblePersonName(text: string) {
  const value = text.trim().replace(/\s+/g, " ");
  return (
    /^[\p{L}][\p{L}\p{M} .’'-]{1,80}$/u.test(value) &&
    value.split(" ").length <= 6 &&
    !sensitive(value) &&
    !/\b(resume|cv|curriculum|vitae|engineer|developer|manager|analyst|scientist|designer|consultant|specialist|intern|internship|student|contact|education|experience|address|company|skills|university|college|institute|school|summary|objective|profile|professional|personal|details|projects?|certifications?|certificates?|achievements?|awards?|languages?|interests?|hobbies|references?|employment|qualifications?|training|portfolio|linkedin|github|technologies|solutions|limited|ltd|inc|pvt)\b/i.test(
      value,
    )
  );
}

export function resumeNameSuggestion(
  lines: string[],
  names: string[],
  emails: string[],
  phones: string[],
  layoutHints: string[] = [],
): string | undefined {
  // Conflicting identifiers may belong to different people; do not pool them.
  if (
    emails.length > 1 ||
    phones.length > 1 ||
    !(emails.length || phones.length)
  )
    return undefined;
  const text = lines.join("\n");
  if (
    !/\b(resume|cv|education|experience|skills|projects?|analyst|engineer|developer)\b/i.test(
      text,
    )
  )
    return undefined;
  const hints = [
    ...new Set(layoutHints.filter((hint) => names.includes(hint))),
  ];
  if (hints.length === 1) return hints[0];
  if (hints.length > 1) return undefined;
  const header = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(resume|cv|curriculum vitae)$/i.test(line))
    .slice(0, 8);
  const contactIndex = header.findIndex(
    (line) =>
      emails.some((email) => line.includes(email)) ||
      phones.some((phone) => line.includes(phone)),
  );
  if (contactIndex < 0) return undefined;
  const beforeContact = header
    .slice(0, contactIndex)
    .filter((line) => names.includes(line));
  return beforeContact.length === 1 ? beforeContact[0] : undefined;
}
