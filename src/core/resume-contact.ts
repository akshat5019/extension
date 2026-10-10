import { normal, type Fields } from "./model";

// English country names come from the browser's local ICU data, not a service.
const regionCodes =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW";
const names = new Intl.DisplayNames(["en"], { type: "region" });
const countryKey = (value: string) => normal(value).replace(/\./g, "");
const countries = new Map<string, string>();
for (const code of regionCodes.split(" ")) {
  const name = names.of(code)!;
  countries.set(countryKey(name), name);
  countries.set(code.toLowerCase(), name);
}
for (const [alias, code] of Object.entries({
  uk: "GB",
  "great britain": "GB",
  england: "GB",
  usa: "US",
  "united states of america": "US",
  uae: "AE",
  "south korea": "KR",
  "north korea": "KP",
  "czech republic": "CZ",
  turkey: "TR",
}))
  countries.set(alias, names.of(code)!);

export const personalLocationLabel =
  /^(?:location|current location|home location|residential location|based in)$/i;
const section =
  /^(?:professional\s+|personal\s+)?(?:summary|objective|experience|employment|work experience|work history|career history|education|skills|technical skills|projects?|references?|certifications?|achievements?|qualifications?)\b/i;
const place = (value: string) =>
  /^[\p{L}][\p{L}\p{M} .’'()-]{0,70}$/u.test(value) &&
  !/\b(?:engineer|analyst|developer|university|college|company|school|inc|ltd|limited|resume|skills|remote|relocate|relocation|willing|preferred|open to)\b/i.test(
    value,
  );

/** Reconstruct contact rows without guessing a name from an email or filename. */
export function resumeLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .flatMap((line) =>
      line === "\f" || /^\s*(?:---+|===+)\s*$/.test(line)
        ? [line]
        : line
            .replace(/,\s*(?=[A-Z0-9._%+-]+@)/gi, "\n")
            .replace(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\s*,\s*/gi, "$1\n")
            .split(
              /\n|\s*[|•]\s*|\s+·\s+|\t+|\s+[–—]\s+|\s+(?=(?:e-?mail(?: address| id)?|mail|mobile(?: number)?|phone(?: number)?|city|country|location|current location)\s*:)/i,
            )
            .map((part) => part.trim().replace(/^[^\p{L}\p{N}+\f]+/u, "")),
    )
    .filter((line) => line === "\f" || line.trim());
  const out: string[] = [];
  const standalone =
    /^(?:full name|name|first name|given name|middle name|last name|family name|surname|e-?mail(?: address)?|phone(?: number)?|mobile(?: number)?|city|town|state|country|postal code|location|current location)\s*:?[\s]*$/i;
  for (let i = 0; i < lines.length; i++) {
    if (
      standalone.test(lines[i]) &&
      lines[i + 1]?.trim() &&
      !standalone.test(lines[i + 1]) &&
      !section.test(lines[i + 1]) &&
      !/^\s*(?:---+|===+)\s*$/.test(lines[i + 1]) &&
      !lines[i + 1].includes(":")
    ) {
      out.push(`${lines[i].replace(/\s*:\s*$/, "")}: ${lines[++i]}`);
    } else out.push(lines[i]);
  }
  return out;
}

export function parseLocation(text: string, explicit = false): Fields {
  const value = text
    .replace(
      /^(?:location|current location|home location|residential location|based in)\b\s*:?\s*/i,
      "",
    )
    .trim();
  const parts = value.split(/\s*,\s*|\s+[-–—]\s+/).filter(Boolean);
  const country = countries.get(countryKey(parts.at(-1) || ""));
  if (!country) {
    // A labelled city/state is useful, but does not prove a country.
    if (explicit && parts.length <= 2 && parts.every(place))
      return { city: parts[0], ...(parts[1] ? { state: parts[1] } : {}) };
    return {};
  }
  if (parts.length === 1) return explicit ? { country } : {};
  let local = parts.slice(0, -1);
  // A labelled street address can contain a city/state after its street segment.
  if (
    explicit &&
    local.length >= 2 &&
    /\d|\b(?:road|street|avenue|lane|block|sector)\b/i.test(local[0])
  )
    local = local.slice(1);
  if (local.length > 2 || !local.every(place))
    return explicit ? { country } : {};
  return { city: local[0], ...(local[1] ? { state: local[1] } : {}), country };
}

export function resumeHeader(lines: string[]) {
  const header: string[] = [];
  for (const line of lines.filter((line) => line.trim())) {
    if (section.test(line) || header.length >= 12) break;
    header.push(line);
  }
  return header;
}

/** Explicit locations take precedence; competing locations are left for review. */
export function addResumeLocation(fields: Fields, header: string[] = []) {
  const labelled = Object.entries(fields)
    .filter(
      ([key, value]) =>
        typeof value === "string" &&
        (personalLocationLabel.test(key.replace(/^custom:/, "")) ||
          key === "address"),
    )
    .map(([, value]) => parseLocation(String(value), true));
  const candidates = labelled.some((candidate) => Object.keys(candidate).length)
    ? labelled
    : header
        .filter((line) => !line.includes(":"))
        .map((line) => parseLocation(line));
  const out = { ...fields };
  if (typeof out.country === "string")
    out.country = countries.get(countryKey(out.country)) || out.country;
  const warnings: string[] = [];
  const additions: Fields = {};
  for (const key of ["city", "state", "country"]) {
    const values = [
      ...new Map(
        candidates
          .filter((candidate) => candidate[key])
          .map((candidate) => [normal(candidate[key]), candidate[key]]),
      ).values(),
    ];
    if (
      values.length > 1 ||
      (out[key] && values.some((value) => normal(value) !== normal(out[key])))
    )
      warnings.push(
        `Conflicting ${key} locations; check this field against the resume. No location value was replaced.`,
      );
    else if (!out[key] && values[0]) additions[key] = values[0];
  }
  // Do not produce, for example, the explicit city Pune with London's country.
  return { fields: warnings.length ? out : { ...out, ...additions }, warnings };
}
