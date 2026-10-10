import { collectFields, describeField, fieldValue, profileValue, writeField, isRequired } from './forms.js';
import { findScope, watchSubmission } from './submission.js';
import { isResumeUpload, isApplicationScope } from './portal.js';

if (!globalThis.__resumeAssistInstalled) {
  globalThis.__resumeAssistInstalled = true;
  let scanned = new Map();
  let scope = null;
  let submission = null;
  const manualEdits = new Map();
  let uploadGeneration = 0;
  let uploadTimer;
  let uploadPanel;
  const uploader = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-');
  const fieldInfo = element => {
    const { label, key } = describeField(element);
    const manual = ['file', 'checkbox', 'radio'].includes(element.type) || element.multiple || /captcha|one.?time|verification code|social security|passport|bank|credit card|birth/i.test(label);
    const options = element.tagName === 'SELECT' ? Array.from(element.options).filter(o => !o.disabled && o.value).map(o => ({ value: o.value, label: o.textContent.trim() })) : null;
    return { label, key, manual, options, type: element.type, required: isRequired(element), current: fieldValue(element), valid: (!element.willValidate || element.checkValidity()) && element.getAttribute('aria-invalid') !== 'true' };
  };
  for (const event of ['input', 'change']) document.addEventListener(event, event => {
    if (event.isTrusted && [...scanned.values()].some(previous => previous.element === event.target && previous.label === describeField(event.target).label)) {
      const field = fieldInfo(event.target);
      manualEdits.set(event.target, { ...field, url: location.href });
      if (event.type === 'change' && field.valid && field.current) chrome.runtime.sendMessage({ type: 'PORTAL_SAVE_MANUAL', url: location.href, field, value: field.current }).catch(() => {});
    }
  }, true);
  function scanFields(preferredScope) {
    submission?.stop(); submission = null;
    scanned = new Map();
    const nextScope = preferredScope || findScope(document);
    if (nextScope !== scope) manualEdits.clear();
    for (const element of manualEdits.keys()) if (!element.isConnected) manualEdits.delete(element);
    scope = nextScope;
    const fields = collectFields(document).filter(element => !scope || scope.contains(element)).map((element, index) => {
      const id = String(index);
      const { label, key } = describeField(element);
      scanned.set(id, { element, label, key, type: element.type });
      return { id, ...fieldInfo(element) };
    });
    return { fields, embeddedForms: document.querySelectorAll('iframe').length, customControls: document.querySelectorAll('[role="combobox"],[contenteditable="true"]').length };
  }
  function fillFields(profile, answers = {}) {
    const result = { filled: 0, skipped: 0, manual: [], applied: [] };
    const visible = new Set(collectFields(document));
    for (const [id, previous] of scanned) {
      const { element } = previous;
      if (!visible.has(element) || fieldValue(element)) { result.skipped++; continue; }
      const { key, label } = describeField(element);
      if (key !== previous.key || label !== previous.label || element.type !== previous.type) { result.manual.push(label); continue; }
      const value = answers?.[id] || profileValue(profile || {}, key);
      if (writeField(element, value)) { result.filled++; result.applied.push({ id, ...fieldInfo(element), value }); }
      else result.manual.push(label);
    }
    return result;
  }

  function uploadNotice(text, state = 'reading') {
    if (!uploadPanel?.host.isConnected) {
      const host = document.createElement('div'); host.id = 'resume-assist-upload';
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style'); style.textContent = ':host{position:fixed;bottom:20px;left:20px;z-index:2147483647;width:340px;font:13px system-ui;color:#203831}section{padding:16px;background:#f0f5ed;border:1px solid #acc79e;border-radius:12px;box-shadow:0 5px 30px #0003}p{line-height:1.5;margin:8px 0}button{background:#284f3e;color:white;border:0;border-radius:6px;padding:8px 12px;cursor:pointer}';
      const box = document.createElement('section'), title = document.createElement('strong'), message = document.createElement('p'), close = document.createElement('button');
      title.textContent = 'Resume Assist · portal upload'; close.textContent = 'Stop / dismiss';
      close.onclick = () => { automaticStopped = true; uploadGeneration++; clearInterval(uploadTimer); host.remove(); };
      box.append(title, message, close); shadow.append(style, box); document.documentElement.append(host);
      uploadPanel = { host, message };
    }
    uploadPanel.message.textContent = text; uploadPanel.host.dataset.state = state;
  }
  document.addEventListener('change', async event => {
    const element = event.target;
    if (!event.isTrusted || element?.type !== 'file' || !isResumeUpload(element, element.files?.[0])) return;
    const file = element.files[0], generation = ++uploadGeneration, initialUrl = location.href;
    try {
      if (!(await chrome.runtime.sendMessage({ type: 'PORTAL_UPLOAD_ALLOWED' }))?.allowed) return;
      clearInterval(uploadTimer); submission?.stop(); submission = null;
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose a resume smaller than 10 MB.');
      uploadNotice('Reading the resume you attached on this portal. Your original upload continues normally.');
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Could not read the attached file.')); reader.readAsDataURL(file);
      });
      const response = await chrome.runtime.sendMessage({ type: 'PORTAL_RESUME_UPLOADED', url: initialUrl, name: file.name, data, uploader, sequence: generation });
      if (generation !== uploadGeneration || location.href !== initialUrl) return;
      if (response?.error) throw new Error(response.error);
      if (!response?.profile) throw new Error('Resume parser did not respond. Reload the extension and try again.');
      const applicationScope = element.closest('[role="dialog"],dialog') || element.form || findScope(document);
      if (!applicationScope) { uploadNotice('Resume read. Open Resume Assist to review the detected profile and scan this form manually.', 'complete'); return; }
      let filled = 0;
      const until = Date.now() + 30000;
      const fill = () => {
        if (generation !== uploadGeneration || location.href !== initialUrl || !applicationScope.isConnected) { clearInterval(uploadTimer); return; }
        const scannedPage = scanFields(applicationScope);
        filled += fillFields(response.profile).filled;
        const missing = scannedPage.fields.filter(field => !fieldValue(scanned.get(field.id).element)).length;
        uploadNotice(`Filled ${filled} details from your portal resume. ${missing} fields still need your attention. Review the form; use Resume Assist for missing answers. Automatic submission needs separate approval.`, 'complete');
        if (Date.now() >= until) { clearInterval(uploadTimer); uploadTimer = null; }
      };
      fill(); uploadTimer = setInterval(fill, 500);
    } catch (error) {
      if (generation === uploadGeneration) uploadNotice(error.message || 'Could not read the attached resume. Enter details manually.', 'error');
    }
  }, true);
  let automaticScope = null, automaticUrl = '', automaticFields = new Set(), automaticBusy = false, automaticStopped = false;
  let automaticTimer;
  async function reuseProfile() {
    if (automaticBusy || automaticStopped || submission || uploadTimer) return;
    const candidate = findScope(document);
    if (!isApplicationScope(candidate)) return;
    const fields = collectFields(document).filter(element => candidate.contains(element));
    if (candidate === automaticScope && automaticUrl === location.href && fields.every(element => automaticFields.has(element))) return;
    automaticBusy = true;
    const url = location.href;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'PORTAL_PROFILE', url });
      if (!result?.profile || location.href !== url || !candidate.isConnected || submission || automaticStopped) return;
      automaticScope = candidate; automaticUrl = url; automaticFields = new Set(fields);
      scanFields(candidate);
      const filled = fillFields(result.profile).filled;
      const missing = [...scanned.values()].filter(({element}) => !fieldValue(element)).length;
      uploadNotice(`Filled ${filled} saved details. ${missing ? `Paused: complete ${missing} missing fields manually.` : 'Review your application.'} Valid manual answers are remembered when you leave a field if remembering is enabled.`, 'complete');
    } catch { /* Disabled portals and unavailable workers leave the form untouched. */ }
    finally { automaticBusy = false; }
  }
  new MutationObserver(() => { clearTimeout(automaticTimer); automaticTimer = setTimeout(reuseProfile, 300); }).observe(document.documentElement, { childList: true, subtree: true });
  reuseProfile();
  setInterval(reuseProfile, 1500);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'RESUME_MANUAL_ANSWERS') {
      const visible = new Set(collectFields(document));
      const fields = [...manualEdits].filter(([element, previous]) => visible.has(element) && previous.url === location.href && previous.label === describeField(element).label && previous.type === element.type && (!scope || scope.contains(element)) && (!element.willValidate || element.checkValidity())).map(([element]) => ({ ...fieldInfo(element), value: fieldValue(element) }));
      respond({ fields, origin: location.origin }); return;
    }
    if (message.type === 'RESUME_CANCEL') {
      automaticStopped = true; submission?.stop(); submission = null; uploadGeneration++; clearInterval(uploadTimer); respond({ cancelled: true }); return;
    }
    if (message.type === 'RESUME_SCAN') {
      automaticStopped = true; uploadGeneration++; clearInterval(uploadTimer);
      respond(scanFields());
    }
    if (message.type === 'RESUME_FILL') {
      respond(fillFields(message.profile, message.answers));
    }
    if (message.type === 'RESUME_AUTOSUBMIT') {
      submission?.stop();
      if (!scope?.isConnected) { respond({ armed: false, reason: 'No unambiguous application form found. Submit manually.' }); return; }
      submission = watchSubmission(document, scope, { allowOptionalBlanks: message.allowOptionalBlanks === true });
      respond({ armed: true });
    }
  });
}
