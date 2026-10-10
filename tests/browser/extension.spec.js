import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';

let context, popup, job, server, temporary;
const useExtension = process.env.RESUME_TEST_EXTENSION === '1';
const fixture = `<!doctype html><title>Application fixture</title><h1>Apply</h1><form>
<label>First name<input id="firstName" name="firstName"></label>
<label>Last name<input id="lastName" name="lastName"></label>
<label>Email address<input id="email" type="email" value="existing@example.com"></label>
<label>Mobile number<input id="phone" type="tel"></label>
<label>Country<select id="country"><option value="">Choose</option><option value="IN">India</option></select></label>
<label>Expected salary<input id="salary" required></label>
<label>Are you authorized to work in this country?<select id="authorized"><option value="">Choose</option><option>Yes</option><option>No</option></select></label>
<label>Resume<input id="attachment" type="file"></label>
<label>I agree to terms<input id="consent" type="checkbox"></label>
<input id="secret" type="password"><input id="hidden" type="hidden"><input id="invisible" style="display:none">
<button type="submit">Submit application</button></form>
<script>window.submitted=false;document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submitted=true});window.events=[];document.querySelector('#firstName').addEventListener('input',()=>window.events.push('input'));</script>`;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/fixture') { res.setHeader('Content-Type', 'text/html'); res.end(fixture); return; }
    try {
      const file = join(resolve('dist'), path === '/' ? 'popup.html' : path.slice(1));
      res.setHeader('Content-Type', path.endsWith('.js') || path.endsWith('.mjs') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.bcmap') ? 'application/octet-stream' : 'text/html');
      res.setHeader('Content-Security-Policy', "script-src 'self'; object-src 'self'");
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  temporary = await mkdtemp(join(tmpdir(), 'resume-assist-test-'));
  const extensionPath = join(temporary, 'extension');
  if (useExtension) await cp(resolve('dist'), extensionPath, { recursive: true });
  // Headless Chromium has no clickable toolbar. Grant only the local fixture host
  // in this temporary test copy; the shipped manifest retains activeTab only.
  if (useExtension) {
    const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
    manifest.host_permissions = [`${url}/*`];
    await writeFile(join(extensionPath, 'manifest.json'), JSON.stringify(manifest));
  }
  context = await chromium.launchPersistentContext(join(temporary, 'browser'), {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', channel: 'chromium', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [...(useExtension ? [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] : []), '--no-sandbox'],
  });
  let popupUrl = url;
  if (useExtension) {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
    popupUrl = `chrome-extension://${worker.url().split('/')[2]}/popup.html`;
  } else {
    // Browser integration mode exercises the actual bundles and DOM under CSP.
    // Only Chrome's APIs are adapted; this does not test extension permissions.
    const storage = {};
    await context.exposeBinding('__resumeStorage', (_source, operation, data) => {
      if (operation === 'set') Object.assign(storage, data);
      if (operation === 'remove') for (const key of Array.isArray(data) ? data : [data]) delete storage[key];
      return data === null || operation !== 'get' ? structuredClone(storage) : Object.fromEntries((Array.isArray(data) ? data : [data]).filter(key => storage[key] !== undefined).map(key => [key, structuredClone(storage[key])]));
    });
    await context.exposeBinding('__resumeTabs', () => [{ id: 1, url: `${url}/fixture` }]);
    await context.exposeBinding('__resumeInject', async () => { await job.addScriptTag({ path: resolve('dist/content.js') }); });
    await context.exposeBinding('__resumeMessage', async (_source, message) => job.evaluate(message => new Promise(resolve => {
      for (const listener of globalThis.__resumeListeners) listener(message, { id: 'test-extension' }, resolve);
    }), message));
    await context.addInitScript(({ url }) => {
      globalThis.__resumeListeners = [];
      const runtime = { id: 'test-extension', getURL: path => `${url}/${path}`, onMessage: { addListener: listener => globalThis.__resumeListeners.push(listener) } };
      const storage = { local: { get: keys => window.__resumeStorage('get', keys), set: data => window.__resumeStorage('set', data), remove: key => window.__resumeStorage('remove', key), setAccessLevel: async () => {} } };
      Object.assign(window.chrome, { runtime, storage, tabs: { query: () => window.__resumeTabs(), sendMessage: (_id, message) => window.__resumeMessage(message) }, scripting: { executeScript: () => window.__resumeInject() } });
    }, { url });
  }
  job = await context.newPage();
  await job.goto(`${url}/fixture`);
  popup = await context.newPage();
  await popup.goto(popupUrl);
});
test.afterAll(async () => {
  await context?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('imports a resume, asks for missing answers, fills and preserves existing answers', async () => {
  await popup.locator('#resumeFile').setInputFiles({ name: 'resume.txt', mimeType: 'text/plain', buffer: Buffer.from('Akshat Sharma\nakshat@example.com\n9876543210\nCountry: India') });
  await expect(popup.locator('#profile-firstName')).toHaveValue('Akshat');
  await expect(popup.locator('#profile-email')).toHaveValue('akshat@example.com');
  await popup.locator('#profileForm button').click();
  await expect(popup.locator('#status')).toContainText('Profile saved');
  await popup.locator('#applyTab').click();
  await job.bringToFront();
  await popup.evaluate(() => document.querySelector('#scanPage').click());
  await expect(popup.locator('#scanSummary')).toContainText('9 fields found');
  await expect(popup.locator('#missingFields')).toContainText('Expected salary');
  await expect(popup.locator('#missingFields')).toContainText('authorized to work');
  await expect(job.locator('#firstName')).toHaveValue('Akshat');
  await expect(job.locator('#phone')).toHaveValue('9876543210');
  const salary = popup.locator('#missingFields .missing-row').filter({ hasText: 'Expected salary' });
  await salary.locator('textarea').fill('1200000');
  const authorization = popup.locator('#missingFields .missing-row').filter({ hasText: 'authorized to work' });
  await authorization.locator('select').selectOption('Yes');
  await popup.evaluate(() => document.querySelector('#fillPage').click());
  await expect(popup.locator('#status')).toContainText('Filled 2 fields');
  await expect(job.locator('#firstName')).toHaveValue('Akshat');
  await expect(job.locator('#lastName')).toHaveValue('Sharma');
  await expect(job.locator('#email')).toHaveValue('existing@example.com');
  await expect(job.locator('#phone')).toHaveValue('9876543210');
  await expect(job.locator('#country')).toHaveValue('IN');
  await expect(job.locator('#salary')).toHaveValue('1200000');
  await expect(job.locator('#authorized')).toHaveValue('Yes');
  await expect(job.locator('#consent')).not.toBeChecked();
  expect(await job.evaluate(() => window.submitted)).toBe(false);
  expect(await job.evaluate(() => window.events)).toEqual(['input']);
  expect(await popup.evaluate(async () => Object.keys(await chrome.storage.local.get(null)))).toEqual(['profile', 'savedAnswers']);
  const remembered = await popup.evaluate(async () => (await chrome.storage.local.get('savedAnswers')).savedAnswers);
  expect(Object.values(remembered).map(entry => entry.answer)).toEqual(['1200000', 'Yes']);
});

test('suggests remembered answers after reopening, requires review, and supports opting out', async () => {
  await job.reload();
  await popup.reload();
  await popup.locator('#applyTab').click();
  await popup.evaluate(() => document.querySelector('#scanPage').click());
  const salary = popup.locator('#missingFields .missing-row').filter({ hasText: 'Expected salary' });
  const authorization = popup.locator('#missingFields .missing-row').filter({ hasText: 'authorized to work' });
  await expect(salary.locator('textarea')).toHaveValue('1200000');
  await expect(authorization.locator('select')).toHaveValue('Yes');
  await expect(salary).toContainText('Saved answer — review');
  await expect(job.locator('#salary')).toHaveValue('');
  await popup.locator('#rememberAnswers').uncheck();
  await salary.locator('textarea').fill('1250000');
  await popup.evaluate(() => document.querySelector('#fillPage').click());
  await expect(job.locator('#salary')).toHaveValue('1250000');
  const remembered = await popup.evaluate(async () => (await chrome.storage.local.get('savedAnswers')).savedAnswers);
  expect(Object.values(remembered).find(entry => entry.label === 'Expected salary').answer).toBe('1200000');
});

test('saves manually entered portal details without learning existing or autofilled values', async () => {
  await job.reload();
  await popup.reload();
  await popup.locator('#applyTab').click();
  await popup.evaluate(() => document.querySelector('#scanPage').click());
  await expect(job.locator('#firstName')).toHaveValue('Akshat');
  await job.locator('#salary').fill('1350000');
  await job.locator('#email').fill('updated@example.com');
  await job.locator('#consent').check();
  await popup.evaluate(() => document.querySelector('#savePageAnswers').click());
  await expect(popup.locator('#status')).toContainText('Saved 2 manually entered answers');
  await popup.reload();
  await expect(popup.locator('#profile-email')).toHaveValue('updated@example.com');
  await expect(popup.locator('#savedAnswersList')).toContainText('Expected salary');
  const remembered = await popup.evaluate(async () => (await chrome.storage.local.get('savedAnswers')).savedAnswers);
  expect(Object.values(remembered).find(entry => entry.label === 'Expected salary').answer).toBe('1350000');
  expect(Object.values(remembered).some(entry => /agree|consent|email|first name/i.test(entry.label))).toBe(false);
  expect(Object.values(remembered)).toHaveLength(2);
});

test('edits and forgets remembered answers without removing the resume profile', async () => {
  await popup.reload();
  const salary = popup.locator('#savedAnswersList .missing-row').filter({ hasText: 'Expected salary' });
  await salary.locator('textarea').fill('1400000');
  await popup.locator('#saveRemembered').click();
  await expect(popup.locator('#status')).toContainText('Remembered answers updated');
  const authorization = popup.locator('#savedAnswersList .missing-row').filter({ hasText: 'authorized to work' });
  await authorization.getByRole('button', { name: 'Forget this answer' }).click();
  await expect(popup.locator('#status')).toContainText('Saved answer removed');
  await expect(popup.locator('#profile-firstName')).toHaveValue('Akshat');
  await popup.reload();
  await expect(popup.locator('#savedAnswersList textarea')).toHaveValue('1400000');
  expect(await popup.evaluate(async () => Object.values((await chrome.storage.local.get('savedAnswers')).savedAnswers))).toHaveLength(1);
});

test('retains saved profile across reopening and deletes it on request', async () => {
  await popup.reload();
  await expect(popup.locator('#profile-firstName')).toHaveValue('Akshat');
  await expect(popup.locator('#savedAnswersList')).toContainText('Expected salary');
  popup.once('dialog', dialog => dialog.accept());
  await popup.locator('#deleteData').click();
  await expect(popup.locator('#profile-firstName')).toHaveValue('');
  expect(await popup.evaluate(async () => await chrome.storage.local.get('profile'))).toEqual({});
  expect(await popup.evaluate(async () => await chrome.storage.local.get('savedAnswers'))).toEqual({});
});

test('requires review of imported details and skips fields changed since scanning', async () => {
  await job.reload();
  await popup.reload();
  await popup.locator('#resumeFile').setInputFiles({ name: 'resume.txt', mimeType: 'text/plain', buffer: Buffer.from('Akshat Sharma\nakshat@example.com\n9876543210') });
  await expect(popup.locator('#profile-firstName')).toHaveValue('Akshat');
  await popup.locator('#applyTab').click();
  await popup.evaluate(() => document.querySelector('#scanPage').click());
  await expect(popup.locator('#status')).toContainText('Save your profile changes');
  await popup.locator('#profileForm button').click();
  await popup.locator('#applyTab').click();
  await popup.evaluate(() => document.querySelector('#scanPage').click());
  await expect(popup.locator('#scanSummary')).toBeVisible();
  await job.evaluate(() => {
    const input = document.querySelector('#firstName');
    input.parentElement.firstChild.textContent = 'Expected salary';
    input.value = '';
    document.querySelector('#phone').value = '9999999999';
  });
  await popup.evaluate(() => document.querySelector('#fillPage').click());
  await expect(popup.locator('#status')).toContainText('Filled 0 fields');
  await expect(job.locator('#firstName')).toHaveValue('');
  await expect(job.locator('#phone')).toHaveValue('9999999999');
  popup.once('dialog', dialog => dialog.accept());
  await popup.locator('#profileTab').click();
  await popup.locator('#deleteData').click();
});

test('reads text-based PDF and DOCX with the extension CSP and local worker', async () => {
  for (const name of ['resume.pdf', 'resume.docx']) {
    await popup.locator('#resumeFile').setInputFiles(resolve('tests/fixtures', name));
    await expect(popup.locator('#status')).toContainText('Found');
    await expect(popup.locator('#profile-email')).toHaveValue('akshat@example.com');
    popup.once('dialog', dialog => dialog.accept());
    await popup.locator('#deleteData').click();
    await expect(popup.locator('#profile-email')).toHaveValue('');
  }
});

test('autofills first, pauses for required details, then automatically attempts submission exactly once', async () => {
  await job.reload();
  await popup.reload();
  await job.evaluate(() => {
    document.querySelector('#secret').remove();
    for (const id of ['firstName', 'lastName', 'email', 'phone', 'country', 'salary', 'authorized', 'attachment', 'consent']) document.getElementById(id).required = true;
    window.submissions = 0;
    document.querySelector('form').addEventListener('submit', () => window.submissions++);
  });
  for (const [key, value] of [['firstName', 'Akshat'], ['lastName', 'Sharma'], ['phone', '9876543210'], ['country', 'India']]) await popup.locator(`#profile-${key}`).fill(value);
  await popup.locator('#profileForm button').click();
  await popup.locator('#applyTab').click();
  await popup.locator('#autoSubmit').check();
  await popup.evaluate(() => document.querySelector('#scanPage').click());
  await expect(popup.locator('#status')).toContainText('Automatic submission is active');
  await expect(job.locator('#firstName')).toHaveValue('Akshat');
  await job.waitForTimeout(1000);
  expect(await job.evaluate(() => window.submitted)).toBe(false);
  await job.locator('#salary').fill('1200000');
  await job.locator('#authorized').selectOption('Yes');
  await job.locator('#consent').check();
  await job.waitForTimeout(500);
  expect(await job.evaluate(() => window.submitted)).toBe(false);
  await job.locator('#attachment').setInputFiles(resolve('tests/fixtures/resume.pdf'));
  await expect.poll(() => job.evaluate(() => window.submissions)).toBe(1);
  await job.waitForTimeout(1200);
  expect(await job.evaluate(() => window.submissions)).toBe(1);
  await expect(job.locator('#resume-assist-progress')).toBeVisible();
});

test('cancels automatic submission during the countdown', async () => {
  await job.reload();
  await popup.reload();
  await job.evaluate(() => document.querySelector('#secret').remove());
  await popup.locator('#applyTab').click();
  await popup.locator('#autoSubmit').check();
  await popup.locator('#allowOptionalBlanks').check();
  await popup.evaluate(() => document.querySelector('#scanPage').click());
  await expect(popup.locator('#status')).toContainText('Automatic submission is active');
  await job.locator('#salary').fill('1200000');
  await job.waitForTimeout(700);
  await popup.evaluate(() => document.querySelector('#cancelSubmission').click());
  await expect(popup.locator('#status')).toContainText('cancelled');
  await job.waitForTimeout(3500);
  expect(await job.evaluate(() => window.submitted)).toBe(false);
});
