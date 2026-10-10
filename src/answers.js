const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/\(required\)|\*/g, '').replace(/\s+/g, ' ').trim();
export function canRemember(field) {
  return field.valid !== false && !field.manual && !['password', 'file', 'checkbox', 'radio'].includes(field.type) && !/password|captcha|one[ -]?time|verification|otp\b|social security|passport|bank|credit card|consent|agree to|birth/i.test(field.label) && !/^(unlabelled field|text|textarea|input|select)$/i.test(field.label);
}
export function questionKey(field, origin) {
  return JSON.stringify([origin, normalize(field.label), field.options ? field.options.map(option => normalize(option.label)).sort() : 'text']);
}
export function rememberAnswer(saved, field, value, origin) {
  if (!canRemember(field) || !String(value || '').trim()) return saved;
  const next = { ...saved };
  const option = field.options?.find(option => option.value === value);
  const key = questionKey(field, origin);
  delete next[key];
  next[key] = { label: field.label, origin, answer: (option?.label || String(value)).trim().slice(0, 5000) };
  while (Object.keys(next).length > 100) delete next[Object.keys(next)[0]];
  return next;
}
export function suggestedAnswer(saved, field, origin) {
  // Empty required fields are invalid until answered; they can still show a
  // saved suggestion. Validation is enforced when saving the entered value.
  if (!canRemember({ ...field, valid: true })) return '';
  const entry = saved[questionKey(field, origin)];
  if (!entry) return '';
  if (field.options) return field.options.find(option => normalize(option.label) === normalize(entry.answer) || normalize(option.value) === normalize(entry.answer))?.value || '';
  return entry.answer;
}
