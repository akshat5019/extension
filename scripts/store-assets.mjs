// Capture the actual built UI with sample data; Chrome APIs are adapted because
// the cloud browser blocks loading unpacked extensions. No live portal is shown.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

await mkdir('docs/store-assets', { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(join(resolve('dist'), path === '/' ? 'popup.html' : path.slice(1))));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const temporary = await mkdtemp(join(tmpdir(), 'resume-store-assets-'));
let context;
try {
  context = await chromium.launchPersistentContext(temporary, { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, viewport: { width: 1280, height: 800 }, args: ['--no-sandbox'] });
  await context.addInitScript(({ url }) => {
    const profile = { firstName: 'Alex', lastName: 'Taylor', email: 'alex@example.com', phone: '202-555-0100', city: 'New York', country: 'United States' };
    const scan = { fields: [
      { id: '1', label: 'First name', key: 'firstName', current: 'Alex' },
      { id: '2', label: 'Email', key: 'email', current: 'alex@example.com' },
      { id: '3', label: 'Expected salary', required: true, current: '' },
      { id: '4', label: 'Notice period', required: true, current: '' },
      { id: '5', label: 'Resume attachment', manual: true, required: true, current: '' },
    ], embeddedForms: 0, customControls: 0 };
    Object.assign(window.chrome, {
      runtime: { getURL: path => `${url}/${path}` },
      storage: { local: { get: async () => ({ profile }), setAccessLevel: async () => {} } },
      tabs: { query: async () => [{ id: 1, url: 'https://example.com/application' }], sendMessage: async (_tab, message) => message.type === 'RESUME_SCAN' ? scan : { filled: 2, skipped: 0, manual: [] } },
      scripting: { executeScript: async () => {} },
    });
  }, { url });
  const page = await context.newPage();
  await page.goto(url);
  await page.locator('#profile-firstName').waitFor();
  await page.waitForFunction(() => document.querySelector('#profile-firstName').value === 'Alex');
  await page.addStyleTag({ content: 'html{background:#e9efe4}body{margin:24px auto;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px #20383122}main{max-height:625px;overflow:auto}' });
  await page.screenshot({ path: 'docs/store-assets/profile.png' });
  await page.locator('#applyTab').click();
  await page.locator('#scanPage').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Filled 2'));
  await page.screenshot({ path: 'docs/store-assets/missing-answers.png' });
  console.log('Created two 1280×800 demo UI screenshots. Live portal testing remains separate.');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
