import { collectFields, describeField, fieldValue, profileValue, writeField, isRequired } from './forms.js';
import { findScope, watchSubmission } from './submission.js';

if (!globalThis.__resumeAssistInstalled) {
  globalThis.__resumeAssistInstalled = true;
  let scanned = new Map();
  let scope = null;
  let submission = null;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'RESUME_CANCEL') {
      submission?.stop(); submission = null; respond({ cancelled: true }); return;
    }
    if (message.type === 'RESUME_SCAN') {
      submission?.stop(); submission = null;
      scanned = new Map();
      scope = findScope(document);
      const fields = collectFields(document).filter(element => !scope || scope.contains(element)).map((element, index) => {
        const id = String(index);
        const { label, key } = describeField(element);
        scanned.set(id, { element, label, key, type: element.type });
        const manual = ['file', 'checkbox', 'radio'].includes(element.type) || element.multiple || /captcha|one.?time|verification code|social security|passport|bank|credit card|birth/i.test(label);
        const options = element.tagName === 'SELECT' ? Array.from(element.options).filter(o => !o.disabled && o.value).map(o => ({ value: o.value, label: o.textContent.trim() })) : null;
        return { id, label, key, manual, options, required: isRequired(element), current: fieldValue(element) };
      });
      respond({ fields, embeddedForms: document.querySelectorAll('iframe').length, customControls: document.querySelectorAll('[role="combobox"],[contenteditable="true"]').length });
    }
    if (message.type === 'RESUME_FILL') {
      const result = { filled: 0, skipped: 0, manual: [] };
      const visible = new Set(collectFields(document));
      for (const [id, previous] of scanned) {
        const { element } = previous;
        if (!visible.has(element) || fieldValue(element)) { result.skipped++; continue; }
        const { key, label } = describeField(element);
        if (key !== previous.key || label !== previous.label || element.type !== previous.type) { result.manual.push(label); continue; }
        const value = message.answers?.[id] || profileValue(message.profile || {}, key);
        if (writeField(element, value)) result.filled++;
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
