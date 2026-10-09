import { PROFILE_FIELDS, parseResume } from './profile.js';
import { profileValue } from './forms.js';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import mammoth from 'mammoth/mammoth.browser.js';

const $ = id => document.getElementById(id);
GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.mjs');
let profile = {};
let scan = null;
let activeTab = null;
let dirty = false;
const profileInputs = new Map();
const answerInputs = new Map();

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function switchTab(apply) {
  $('profileSection').hidden = apply;
  $('applySection').hidden = !apply;
  for (const [id, selected] of [['profileTab', !apply], ['applyTab', apply]]) {
    $(id).classList.toggle('active', selected);
    $(id).setAttribute('aria-selected', String(selected));
  }
  status('');
}

for (const [key, title] of PROFILE_FIELDS) {
  const label = document.createElement('label');
  label.className = 'field';
  label.textContent = title;
  const input = document.createElement('input');
  input.id = `profile-${key}`;
  input.name = key;
  input.type = key === 'email' ? 'email' : key === 'phone' ? 'tel' : ['linkedin', 'github', 'website'].includes(key) ? 'url' : 'text';
  input.maxLength = key === 'skills' ? 5000 : 500;
  input.autocomplete = 'off';
  label.append(input);
  $('profileFields').append(label);
  profileInputs.set(key, input);
}

function showProfile() {
  for (const [key, input] of profileInputs) input.value = profile[key] || '';
}

function readProfile() {
  return Object.fromEntries(Array.from(profileInputs, ([key, input]) => [key, input.value.trim()]));
}

async function extractResume(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a resume smaller than 10 MB.');
  const data = await file.arrayBuffer();
  const ext = file.name.split('.').at(-1).toLowerCase();
  let text;
  if (ext === 'txt') text = new TextDecoder().decode(data);
  else if (ext === 'docx') text = (await mammoth.extractRawText({ arrayBuffer: data })).value;
  else if (ext === 'pdf') {
    const loading = getDocument({ data, isEvalSupported: false, useSystemFonts: true, cMapUrl: chrome.runtime.getURL('cmaps/'), cMapPacked: true, standardFontDataUrl: chrome.runtime.getURL('standard_fonts/'), wasmUrl: chrome.runtime.getURL('wasm/') });
    try {
      const pdf = await loading.promise;
      if (pdf.numPages > 50) throw new Error('Choose a resume with 50 pages or fewer.');
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join(''));
      }
      text = pages.join('\n');
    } finally { await loading.destroy(); }
  } else throw new Error('Please choose a PDF, DOCX or TXT file.');
  if (!text.trim()) throw new Error('No readable text found. For a scanned/image resume, use a text-based PDF, DOCX or TXT, or enter your details below.');
  if (text.length > 250000) throw new Error('This document contains too much text. Choose a shorter resume.');
  return text;
}

$('profileTab').addEventListener('click', () => switchTab(false));
$('applyTab').addEventListener('click', () => switchTab(true));
$('resumeFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  event.target.disabled = true;
  status('Reading your resume locally…');
  try {
    const extracted = parseResume(await extractResume(file));
    const current = readProfile();
    let added = 0;
    for (const [key, value] of Object.entries(extracted)) {
      if (!current[key] && value) { current[key] = value; added++; }
    }
    profile = current;
    dirty = true;
    showProfile();
    $('fileInfo').textContent = `Read ${file.name}. The original file is not stored.`;
    status(`Found ${added} new details. Check your name and contact details, add anything missing, then save your profile.`);
  } catch (error) { status(error.message || 'Could not read this resume. Enter your details manually.', true); }
  finally { event.target.disabled = false; event.target.value = ''; }
});

$('profileForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    profile = readProfile();
    await chrome.storage.local.set({ profile });
    dirty = false;
    scan = null;
    $('answersForm').hidden = true;
    $('scanSummary').hidden = true;
    status('Profile saved in this browser. Open a job form, then choose Fill application.');
  } catch { status('Could not save your profile. Please try again.', true); }
});

$('deleteData').addEventListener('click', async () => {
  if (!confirm('Delete your saved profile from this browser?')) return;
  try {
    await chrome.storage.local.remove('profile');
    if (activeTab?.id) await chrome.tabs.sendMessage(activeTab.id, { type: 'RESUME_CANCEL' }).catch(() => {});
    profile = {};
    dirty = false;
    showProfile();
    scan = null;
    answerInputs.clear();
    $('missingFields').replaceChildren();
    $('fileInfo').textContent = '';
    $('answersForm').hidden = true;
    $('scanSummary').hidden = true;
    status('Your saved profile has been deleted.');
  } catch { status('Could not delete your data. Please try again.', true); }
});

function selectAccepts(field, value) {
  if (!field.options) return true;
  const normal = text => text.toLowerCase().trim();
  return field.options.some(option => normal(option.value) === normal(value) || normal(option.label) === normal(value));
}

function renderScan(result) {
  answerInputs.clear();
  $('missingFields').replaceChildren();
  const empty = result.fields.filter(field => !field.current);
  const ready = empty.filter(field => !field.manual && profileValue(profile, field.key) && selectAccepts(field, profileValue(profile, field.key)));
  const missing = empty.filter(field => !ready.includes(field));
  $('scanSummary').hidden = false;
  $('scanSummary').textContent = `${result.fields.length} fields found · ${ready.length} ready to fill · ${missing.length} need attention. ${result.embeddedForms ? 'Embedded forms may require opening the application directly. ' : ''}${result.customControls ? 'Custom controls may need manual entry.' : ''}`;
  for (const field of missing) {
    const row = document.createElement('div');
    row.className = 'missing-row';
    const label = document.createElement('label');
    label.textContent = `${field.label}${field.required ? ' (required)' : ''}`;
    label.htmlFor = `answer-${field.id}`;
    row.append(label);
    if (field.manual) {
      const tip = document.createElement('p');
      tip.textContent = 'Complete this control directly on the job portal.';
      row.append(tip);
    } else {
      const input = document.createElement(field.options ? 'select' : 'textarea');
      input.id = `answer-${field.id}`;
      if (field.options) {
        input.append(new Option('Leave blank / fill manually', ''));
        for (const option of field.options) input.append(new Option(option.label, option.value));
      } else { input.rows = 2; input.placeholder = 'Your answer, or leave blank to fill on the portal'; }
      row.append(input);
      answerInputs.set(field.id, input);
    }
    $('missingFields').append(row);
  }
  $('answersForm').hidden = result.fields.length === 0;
}

async function armSubmission() {
  if (!$('autoSubmit').checked) return '';
  const result = await chrome.tabs.sendMessage(activeTab.id, { type: 'RESUME_AUTOSUBMIT', allowOptionalBlanks: $('allowOptionalBlanks').checked });
  return result?.armed ? ' Automatic submission is active: finish missing details on the portal. The page shows its status and a Cancel button.' : ` ${result?.reason || 'Automatic submission is unavailable on this page.'}`;
}

$('cancelSubmission').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'RESUME_CANCEL' });
    $('autoSubmit').checked = false;
    status('Automatic submission cancelled on this page.');
  } catch { status('No active automatic submission found on this page.'); }
});

$('scanPage').addEventListener('click', async () => {
  $('scanPage').disabled = true;
  scan = null;
  $('answersForm').hidden = true;
  $('scanSummary').hidden = true;
  try {
    const unsaved = JSON.stringify(readProfile()) !== JSON.stringify(Object.fromEntries(PROFILE_FIELDS.map(([key]) => [key, profile[key] || ''])));
    if (dirty || unsaved) { switchTab(false); throw new Error('Save your profile changes before scanning an application.'); }
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id || !/^https?:\/\//i.test(activeTab.url || '')) throw new Error('Open a job application on a regular website, then try again.');
    await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content.js'] });
    scan = await chrome.tabs.sendMessage(activeTab.id, { type: 'RESUME_SCAN' });
    if (!scan || !Array.isArray(scan.fields)) throw new Error('This page could not be scanned. Reload the page and try again.');
    const result = await chrome.tabs.sendMessage(activeTab.id, { type: 'RESUME_FILL', profile });
    scan = await chrome.tabs.sendMessage(activeTab.id, { type: 'RESUME_SCAN' });
    renderScan(scan);
    const submissionStatus = scan.fields.length ? await armSubmission() : '';
    status(scan.fields.length ? `Filled ${result.filled} known details. Paused for missing answers below or on the portal.${submissionStatus}` : 'No visible form fields found. Open the application form or its next step, then rescan.', !scan.fields.length);
  } catch (error) { status(error.message || 'Cannot access this page. Open the application directly and retry.', true); }
  finally { $('scanPage').disabled = false; }
});

$('answersForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!scan || !activeTab?.id) return;
  $('fillPage').disabled = true;
  try {
    const answers = Object.fromEntries(Array.from(answerInputs, ([id, input]) => [id, input.value.trim()]));
    const result = await chrome.tabs.sendMessage(activeTab.id, { type: 'RESUME_FILL', profile, answers });
    if (!result) throw new Error('The page changed. Rescan the application before filling.');
    scan = await chrome.tabs.sendMessage(activeTab.id, { type: 'RESUME_SCAN' });
    renderScan(scan);
    const submissionStatus = await armSubmission();
    status(`Filled ${result.filled} fields. ${result.manual.length} still need manual entry; ${result.skipped} existing or unavailable fields left unchanged.${submissionStatus || ' Review the portal and submit manually, or enable automatic submission and resume.'}`);
  } catch (error) { status(error.message || 'The page changed. Rescan the application before filling.', true); }
  finally { $('fillPage').disabled = false; }
});

async function initialize() {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    const saved = await chrome.storage.local.get('profile');
    profile = saved.profile || {};
    showProfile();
  } catch { status('Could not load your saved profile.', true); }
}
initialize();
