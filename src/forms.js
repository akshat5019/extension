const normalize = text => String(text || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();

export function classifyField(text, autocomplete = '', type = '') {
  const label = normalize(text);
  if (/password|captcha|one time|verification code|social security|passport|bank|credit card|date of birth|birth date/.test(label)) return null;
  // Questions with legal/personal implications always require explicit answers.
  if (/authorized|authorised|authorization|authorisation|sponsor|visa|salary|compensation|gender|race|ethnic|disabilit|veteran|pronoun|relocat|notice period|start date|years|experience|cover letter|why |agree|consent|citizen/.test(label)) return null;
  const auto = {
    'given-name': 'firstName', 'family-name': 'lastName', name: 'fullName', email: 'email', tel: 'phone',
    'street-address': 'address', 'address-line1': 'address', 'address-level2': 'city',
    'address-level1': 'state', 'postal-code': 'postalCode', 'country-name': 'country', country: 'country',
    organization: 'currentCompany', 'organization-title': 'jobTitle',
  };
  const token = autocomplete.split(/\s+/).at(-1);
  if (auto[token]) return auto[token];
  const patterns = [
    ['firstName', /\b(first|given|forename)\s*(name)?\b/], ['lastName', /\b(last|family|sur)\s*name\b/],
    ['fullName', /\b(full name|your name|legal name|candidate name)\b|^name$/],
    ['email', /\be ?mail\b/], ['phone', /\b(phone|mobile|telephone|contact number)\b/],
    ['linkedin', /linked\s?in/], ['github', /github/], ['website', /\b(website|portfolio|personal url)\b/],
    ['postalCode', /\b(zip|postal|pin code|pincode)\b/], ['city', /\b(city|town)\b/],
    ['state', /\b(state|province|region)\b/], ['country', /\bcountry\b/],
    ['address', /\b(street address|address line 1|address1)\b|^address$/],
    ['currentCompany', /\b(current company|current employer|company name|employer name)\b/],
    ['jobTitle', /\b(current title|current job title|job title|position title)\b/],
    ['school', /\b(school|university|college|institution)\b/], ['degree', /\bdegree\b/], ['skills', /\bskills\b/],
  ];
  for (const [key, regex] of patterns) if (regex.test(label)) return key;
  if (type === 'email') return 'email';
  if (type === 'tel') return 'phone';
  return null;
}

export function profileValue(profile, key) {
  if (key === 'fullName') return [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  return profile[key] || '';
}

export function describeField(element) {
  const doc = element.ownerDocument;
  const labels = Array.from(element.labels || []).map(label => label.textContent.trim()).filter(Boolean);
  const ariaLabels = (element.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => doc.getElementById(id)?.textContent || '').filter(Boolean);
  const visibleLabel = labels.join(' ') || ariaLabels.join(' ') || element.getAttribute('aria-label') || element.getAttribute('placeholder');
  const fallback = element.name || element.id || element.getAttribute('autocomplete') || element.type;
  const label = String(visibleLabel || fallback || 'Unlabelled field').replace(/\s+/g, ' ').trim().slice(0, 240);
  return { label, key: classifyField(visibleLabel || fallback, element.autocomplete, element.type) };
}

export function collectFields(doc) {
  return Array.from(doc.querySelectorAll('input,select,textarea')).filter(el => {
    if (el.disabled || el.readOnly || el.closest('[hidden],[inert]') || ['hidden', 'submit', 'button', 'reset', 'image', 'password'].includes(el.type)) return false;
    const style = doc.defaultView.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  });
}

export function fieldValue(element) {
  if (['radio', 'checkbox'].includes(element.type)) return element.checked ? element.value || 'checked' : '';
  if (element.type === 'file') return element.files?.length ? 'Attached' : '';
  return element.value || '';
}

export function isRequired(element) {
  return element.required || element.getAttribute('aria-required') === 'true' || /\*|\(required\)/i.test(describeField(element).label);
}

export function writeField(element, value) {
  if (!value || ['file', 'checkbox', 'radio', 'password'].includes(element.type)) return false;
  if (element.tagName === 'SELECT') {
    if (element.multiple) return false;
    const match = Array.from(element.options).find(option => !option.disabled && option.value && (normalize(option.value) === normalize(value) || normalize(option.textContent) === normalize(value)));
    if (!match) return false;
    value = match.value;
  }
  const win = element.ownerDocument.defaultView;
  const prototype = element.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  element.dispatchEvent(new win.Event('input', { bubbles: true }));
  element.dispatchEvent(new win.Event('change', { bubbles: true }));
  return element.value === value;
}
