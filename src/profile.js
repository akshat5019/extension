export const PROFILE_FIELDS = [
  ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'],
  ['phone', 'Phone'], ['address', 'Street address'], ['city', 'City'],
  ['state', 'State / province'], ['postalCode', 'Postal / ZIP code'], ['country', 'Country'],
  ['linkedin', 'LinkedIn URL'], ['github', 'GitHub URL'], ['website', 'Portfolio / website'],
  ['currentCompany', 'Current company'], ['jobTitle', 'Current job title'],
  ['school', 'School / university'], ['degree', 'Degree'], ['skills', 'Skills'],
];

export function parseResume(text) {
  const profile = {};
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) profile.email = email[0];
  const phone = Array.from(text.matchAll(/\+?[\d(][\d .()-]{8,}\d/g)).find(match => {
    const digits = match[0].replace(/\D/g, '').length;
    return digits >= 10 && digits <= 15;
  });
  if (phone) profile.phone = phone[0];
  for (const [key, pattern] of [
    ['linkedin', /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w%-]+\/?/i],
    ['github', /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+\/?/i],
  ]) {
    const match = text.match(pattern);
    if (match) profile[key] = match[0].startsWith('http') ? match[0] : `https://${match[0]}`;
  }
  const name = lines.slice(0, 5).find(line => /^[\p{L}][\p{L} .'-]{2,60}$/u.test(line) && line.split(/\s+/).length >= 2 && line.split(/\s+/).length <= 5 && !/resume|curriculum|engineer|developer|manager|designer|contact|education|experience/i.test(line));
  if (name) {
    const words = name.split(/\s+/);
    profile.firstName = words.shift();
    profile.lastName = words.join(' ');
  }
  for (const [key, label] of [ ['city', 'city'], ['state', 'state|province'], ['country', 'country'], ['postalCode', 'zip|postal code'], ['currentCompany', 'current company'], ['jobTitle', 'current (?:job )?title'], ['school', 'school|university'], ['degree', 'degree'], ['skills', 'skills'], ['website', 'website|portfolio'] ]) {
    const match = text.match(new RegExp(`^(?:${label})\\s*:\\s*(.+)$`, 'im'));
    if (match) profile[key] = match[1].trim();
  }
  return profile;
}
