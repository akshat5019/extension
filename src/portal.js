export function portalPattern(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Open a job portal website first.');
  return `${parsed.protocol}//${parsed.hostname}/*`;
}
export function isResumeUpload(element, file) {
  if (!file || !/\.(pdf|docx|txt)$/i.test(file.name)) return false;
  const labelled = (element.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => element.ownerDocument.getElementById(id)?.textContent || '').join(' ');
  const nearby = element.parentElement?.tagName === 'DIV' ? element.parentElement.textContent.slice(0, 240) : '';
  const text = [...Array.from(element.labels || [], label => label.textContent), labelled, nearby, element.getAttribute('aria-label'), element.name, element.id, file.name].filter(Boolean).join(' ');
  return /resume|résumé|curriculum|\bcv\b/i.test(text) && !/cover.?letter|passport|identity|certificate/i.test(text);
}

export function isApplicationScope(scope) {
  if (!scope || scope.querySelector('input[type="password"]')) return false;
  const text = `${scope.getAttribute('aria-label') || ''} ${scope.textContent || ''}`;
  const resume = [...scope.querySelectorAll('input[type="file"]')].some(input => isResumeUpload(input, { name: 'attachment.pdf' }));
  return resume || /(?:submit|send|complete|finish|job) application|apply (?:for|to) (?:this |a |the )?(?:job|position)/i.test(text);
}
