import { collectFields, describeField, fieldValue, profileValue, writeField, isRequired } from './forms.js';
import { findScope, watchSubmission } from './submission.js';

if (!globalThis.__resumeAssistInstalled) {
  globalThis.__resumeAssistInstalled = true;
  let scanned = new Map();
  let scope = null;
  let submission = null;
  const manualEdits = new Map();
  const fieldInfo = element => {
    const { label, key } = describeField(element);
    const manual = ['file', 'checkbox', 'radio'].includes(element.type) || element.multiple || /captcha|one.?time|verification code|social security|passport|bank|credit card|birth/i.test(label);
    const options = element.tagName === 'SELECT' ? Array.from(element.options).filter(o => !o.disabled && o.value).map(o => ({ value: o.value, label: o.textContent.trim() })) : null;
    return { label, key, manual, options, type: element.type, required: isRequired(element), current: fieldValue(element), valid: (!element.willValidate || element.checkValidity()) && element.getAttribute('aria-invalid') !== 'true' };
  };
  for (const event of ['input', 'change']) document.addEventListener(event, event => {
    if (event.isTrusted && [...scanned.values()].some(previous => previous.element === event.target && previous.label === describeField(event.target).label)) manualEdits.set(event.target, { ...fieldInfo(event.target), url: location.href });
  }, true);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'RESUME_MANUAL_ANSWERS') {
      const visible = new Set(collectFields(document));
      const fields = [...manualEdits].filter(([element, previous]) => visible.has(element) && previous.url === location.href && previous.label === describeField(element).label && previous.type === element.type && (!scope || scope.contains(element)) && (!element.willValidate || element.checkValidity())).map(([element]) => ({ ...fieldInfo(element), value: fieldValue(element) }));
      respond({ fields, origin: location.origin }); return;
    }
    if (message.type === 'RESUME_CANCEL') {
      submission?.stop(); submission = null; respond({ cancelled: true }); return;
    }
    if (message.type === 'RESUME_SCAN') {
      submission?.stop(); submission = null;
      scanned = new Map();
      const nextScope = findScope(document);
      if (nextScope !== scope) manualEdits.clear();
      for (const element of manualEdits.keys()) if (!element.isConnected) manualEdits.delete(element);
      scope = nextScope;
      const fields = collectFields(document).filter(element => !scope || scope.contains(element)).map((element, index) => {
        const id = String(index);
        const { label, key } = describeField(element);
        scanned.set(id, { element, label, key, type: element.type });
        return { id, ...fieldInfo(element) };
      });
      respond({ fields, embeddedForms: document.querySelectorAll('iframe').length, customControls: document.querySelectorAll('[role="combobox"],[contenteditable="true"]').length });
    }
    if (message.type === 'RESUME_FILL') {
      const result = { filled: 0, skipped: 0, manual: [], applied: [] };
      const visible = new Set(collectFields(document));
      for (const [id, previous] of scanned) {
        const { element } = previous;
        if (!visible.has(element) || fieldValue(element)) { result.skipped++; continue; }
        const { key, label } = describeField(element);
        if (key !== previous.key || label !== previous.label || element.type !== previous.type) { result.manual.push(label); continue; }
        const value = message.answers?.[id] || profileValue(message.profile || {}, key);
        if (writeField(element, value)) { result.filled++; result.applied.push({ id, ...fieldInfo(element), value }); }
        else result.manual.push(label);
      }
      respond(result);
    }
    if (message.type === 'RESUME_AUTOSUBMIT') {
      submission?.stop();
      if (!scope?.isConnected) { respond({ armed: false, reason: 'No unambiguous application form found. Submit manually.' }); return; }
      submission = watchSubmission(document, scope, { allowOptionalBlanks: message.allowOptionalBlanks === true });
      respond({ armed: true });
    }
  });
}
