import { portalPattern } from './portal.js';
import { canRemember, rememberAnswer } from './answers.js';
import { PROFILE_FIELDS } from './profile.js';

chrome.runtime.onInstalled.addListener(() => {
  // Prevent page content scripts from reading stored resume/profile data directly.
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
});

let creatingParser;
async function ensureParser() {
  if (await chrome.offscreen.hasDocument()) return;
  creatingParser ??= chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['DOM_PARSER'], justification: 'Read a user-selected resume locally using the bundled PDF and DOCX parsers.' }).finally(() => { creatingParser = null; });
  await creatingParser;
}
const uploads = new Map();
let saving = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (['PORTAL_PROFILE', 'PORTAL_SAVE_MANUAL'].includes(message.type) && sender.id === chrome.runtime.id) {
    const operation = async () => {
      try {
        if (!sender.tab || sender.frameId !== 0 || sender.url !== message.url || !await chrome.permissions.contains({ origins: [portalPattern(sender.url)] })) throw new Error('Portal access unavailable.');
        const saved = await chrome.storage.local.get(['profile', 'savedAnswers', 'rememberAnswers']);
        if (message.type === 'PORTAL_PROFILE') { respond({ profile: saved.profile || {} }); return; }
        const field = message.field, value = message.value;
        if (saved.rememberAnswers === false || !field || typeof field.label !== 'string' || field.label.length > 500 || typeof value !== 'string' || !value.trim() || value.length > 5000 || !canRemember(field)) { respond({ saved: false }); return; }
        const profile = { ...saved.profile };
        if (PROFILE_FIELDS.some(([key]) => key === field.key)) profile[field.key] = field.options?.find(option => option.value === value)?.label || value.trim();
        const savedAnswers = PROFILE_FIELDS.some(([key]) => key === field.key) ? saved.savedAnswers || {} : rememberAnswer(saved.savedAnswers || {}, field, value, new URL(sender.url).origin);
        await chrome.storage.local.set({ profile, savedAnswers });
        const draftKey = `resumeDraft:${sender.tab.id}`;
        const draft = (await chrome.storage.session.get(draftKey))[draftKey];
        if (draft?.url === sender.url && PROFILE_FIELDS.some(([key]) => key === field.key)) await chrome.storage.session.set({ [draftKey]: { ...draft, profile: { ...draft.profile, [field.key]: profile[field.key] } } });
        respond({ saved: true });
      } catch { respond({ saved: false }); }
    };
    saving = saving.then(operation, operation);
    return true;
  }
  if (message.type === 'PORTAL_UPLOAD_ALLOWED' && sender.id === chrome.runtime.id) {
    (async () => {
      try { respond({ allowed: !!sender.tab && sender.frameId === 0 && await chrome.permissions.contains({ origins: [portalPattern(sender.url)] }) }); }
      catch { respond({ allowed: false }); }
    })();
    return true;
  }
  if (message.type !== 'PORTAL_RESUME_UPLOADED' || sender.id !== chrome.runtime.id) return;
  (async () => {
    try {
      if (!sender.tab || sender.frameId !== 0 || sender.url !== message.url || typeof message.uploader !== 'string' || message.uploader.length > 128 || !Number.isSafeInteger(message.sequence) || message.sequence < 1 || typeof message.data !== 'string' || message.data.length > 14 * 1024 * 1024 || !/\.(pdf|docx|txt)$/i.test(message.name || '')) throw new Error('Invalid resume upload context.');
      const origin = portalPattern(sender.url);
      if (!await chrome.permissions.contains({ origins: [origin] })) throw new Error('Enable Resume Assist on this portal before attaching your resume.');
      const previous = uploads.get(sender.tab.id);
      if (previous?.uploader === message.uploader && previous.sequence >= message.sequence) throw new Error('A newer resume was selected.');
      const token = Symbol(); uploads.set(sender.tab.id, { token, uploader: message.uploader, sequence: message.sequence });
      await ensureParser();
      const parsed = await chrome.runtime.sendMessage({ type: 'OFFSCREEN_PARSE_RESUME', name: message.name, data: message.data });
      if (parsed?.error) throw new Error(parsed.error);
      if (!parsed?.profile || !Object.keys(parsed.profile).length) throw new Error('No recognizable resume details found. Enter your profile manually.');
      const tab = await chrome.tabs.get(sender.tab.id);
      if (tab.url !== message.url || uploads.get(sender.tab.id)?.token !== token || !await chrome.permissions.contains({ origins: [origin] })) throw new Error('The page or resume changed while reading. Attach the resume again on the current application.');
      const saved = await chrome.storage.local.get('profile');
      const profile = { ...saved.profile, ...parsed.profile };
      await chrome.storage.session.set({ [`resumeDraft:${sender.tab.id}`]: { profile, url: message.url } });
      respond({ profile });
    } catch (error) { respond({ error: error.message || 'Could not read the attached resume.' }); }
  })();
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  uploads.delete(tabId);
  chrome.storage.session.remove(`resumeDraft:${tabId}`);
});
