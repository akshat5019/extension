import { collectFields, describeField, fieldValue, isRequired } from './forms.js';

const visible = el => el.getClientRects().length > 0 && el.ownerDocument.defaultView.getComputedStyle(el).visibility !== 'hidden';
export function findScope(doc) {
  const fields = collectFields(doc);
  const groups = new Map();
  for (const field of fields) {
    const scope = field.closest('[role="dialog"],dialog') || field.form;
    if (scope) groups.set(scope, (groups.get(scope) || 0) + 1);
  }
  const ordered = [...groups].sort((a, b) => b[1] - a[1]);
  if (!ordered.length || (ordered[1] && ordered[0][1] === ordered[1][1])) return null;
  return ordered[0][0];
}

export function submissionReadiness(doc, scope, allowOptionalBlanks = false) {
  if (!scope?.isConnected) return { ready: false, reason: 'Application changed. Scan this step again.' };
  const fields = collectFields(doc).filter(el => scope.contains(el));
  if (!fields.length) return { ready: false, reason: 'No application fields found. Open the application directly.' };
  const missing = [];
  for (const field of fields) {
    const required = isRequired(field);
    let value = fieldValue(field);
    if (field.type === 'radio' && field.name) {
      const group = fields.filter(el => el.type === 'radio' && el.name === field.name && el.form === field.form);
      value = group.some(el => el.checked) ? 'Selected' : '';
      if (missing.some(item => item.radioGroup === field.name)) continue;
    }
    if (!value && (required || !allowOptionalBlanks)) missing.push({ label: describeField(field).label, radioGroup: field.type === 'radio' ? field.name : null });
    else if (field.willValidate && !field.checkValidity()) missing.push({ label: `${describeField(field).label} (invalid)` });
  }
  if (missing.length) return { ready: false, reason: `Paused: complete ${missing.length} details on the portal: ${missing.map(item => item.label).join(', ')}`, missing };
  if (scope.querySelector('iframe,[role="combobox"],[role="listbox"],[role="radio"]:not(input),[role="checkbox"]:not(input),[role="textbox"]:not(input):not(textarea),[role="switch"],[contenteditable="true"],input[type="password"]') || [...scope.querySelectorAll('*')].some(el => el.shadowRoot)) return { ready: false, reason: 'Embedded forms, custom controls, or account fields require manual review and submission.' };
  if (doc.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"],.g-recaptcha,.h-captcha,[data-sitekey]')) return { ready: false, reason: 'CAPTCHA detected. Complete verification and submit manually.' };
  if (scope.querySelector('[aria-invalid="true"]') || [...scope.querySelectorAll('[role="alert"]')].some(el => visible(el) && el.textContent.trim())) return { ready: false, reason: 'The portal shows an error. Correct it before submitting.' };
  const buttons = [...scope.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(button => {
    if (!visible(button)) return false;
    const label = (button.getAttribute('aria-label') || button.textContent || button.value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    // Next, Continue, Review and Save are never mistaken for final submission.
    const exact = /^(submit(?: (?:your )?application)?|send application|complete application|finish application)$/;
    const nativeApply = scope.tagName === 'FORM' && /^(apply|apply now)$/.test(label);
    return exact.test(label) || nativeApply;
  });
  if (buttons.length !== 1) return { ready: false, reason: 'No unique final Submit button found. For multi-step forms, use Next / Review manually, then scan the final step.' };
  const button = buttons[0];
  if (button.disabled || button.getAttribute('aria-disabled') === 'true') return { ready: false, reason: 'The portal has disabled Submit. Complete its remaining checks.' };
  if (scope.tagName === 'FORM' && !scope.checkValidity()) return { ready: false, reason: 'The portal requires additional valid answers before submission.' };
  return { ready: true, button };
}

export function watchSubmission(doc, scope, options = {}) {
  const host = doc.createElement('div');
  host.id = 'resume-assist-progress';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = ':host{position:fixed;bottom:20px;right:20px;z-index:2147483647;width:360px;font:13px system-ui;color:#203831}section{padding:16px;background:#f0f5ed;border:1px solid #acc79e;border-radius:12px;box-shadow:0 5px 30px #0003}p{line-height:1.5;margin:8px 0;overflow-wrap:anywhere}button{background:#284f3e;color:white;border:0;border-radius:6px;padding:8px 12px;cursor:pointer}';
  const box = doc.createElement('section');
  const title = doc.createElement('strong'); title.textContent = 'Resume Assist · automatic submission';
  const message = doc.createElement('p');
  const cancel = doc.createElement('button'); cancel.textContent = 'Cancel automatic submission';
  box.append(title, message, cancel); shadow.append(style, box); doc.documentElement.append(host);
  let active = true, timer, readySince = null;
  const started = Date.now(), initialUrl = doc.location.href;
  let snapshot = '';
  function stop(text) {
    active = false; clearInterval(timer); message.textContent = text;
    cancel.textContent = 'Dismiss'; cancel.onclick = () => host.remove();
  }
  function tick() {
    if (!active) return;
    if (Date.now() - started > 600000 || doc.location.href !== initialUrl || !scope.isConnected) return stop('Stopped: page changed or the 10-minute session expired. Scan again when ready.');
    const result = submissionReadiness(doc, scope, options.allowOptionalBlanks);
    if (!result.ready) { readySince = null; snapshot = ''; message.textContent = result.reason; return; }
    // Any edits or new fields restart the countdown, so typing cannot race Submit.
    const current = JSON.stringify(collectFields(doc).filter(el => scope.contains(el)).map(el => [describeField(el).label, fieldValue(el)]));
    if (current !== snapshot) { snapshot = current; readySince = null; }
    readySince ??= Date.now();
    const remaining = Math.ceil((3000 - (Date.now() - readySince)) / 1000);
    if (remaining > 0) { message.textContent = `All details complete. Submitting in ${remaining} seconds. Cancel to keep reviewing.`; return; }
    stop('Submission attempted once. Check the portal for confirmation or errors.');
    result.button.click();
  }
  cancel.onclick = () => stop('Automatic submission cancelled. You can submit manually.');
  timer = setInterval(tick, 250); tick();
  return { stop: () => { clearInterval(timer); active = false; host.remove(); } };
}
