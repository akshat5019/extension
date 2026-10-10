import { extractResume } from './resume.js';
import { parseResume } from './profile.js';
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message.type !== 'OFFSCREEN_PARSE_RESUME') return;
  (async () => {
    try {
      if (typeof message.data !== 'string' || message.data.length > 14 * 1024 * 1024) throw new Error('Resume exceeds the supported size.');
      const bytes = Uint8Array.from(atob(message.data), char => char.charCodeAt(0));
      const file = new File([bytes], message.name);
      const profile = parseResume(await extractResume(file));
      for (const key of Object.keys(profile)) profile[key] = profile[key].slice(0, key === 'skills' ? 5000 : 500);
      respond({ profile });
    } catch (error) { respond({ error: error.message || 'Could not read this resume.' }); }
  })();
  return true;
});
