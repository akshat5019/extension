import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { portalPattern, isResumeUpload, isApplicationScope } from '../src/portal.js';

test('portal permission is scoped to one protocol and hostname', () => {
  assert.equal(portalPattern('https://www.naukri.com/application?id=1'), 'https://www.naukri.com/*');
  assert.equal(portalPattern('http://127.0.0.1:3000/apply'), 'http://127.0.0.1/*');
  assert.throws(() => portalPattern('chrome://extensions'));
});
test('detects supported resume/CV attachments using portal labels, ARIA and filename', () => {
  const { window } = new JSDOM('<label>Upload resume<input id="resume" type="file"></label><span id="cvLabel">Attach CV</span><input aria-labelledby="cvLabel" id="cv"><label>Cover letter<input id="cover"></label><label>Certificate<input id="certificate"></label><input id="generic">');
  const get = id => window.document.getElementById(id);
  assert.equal(isResumeUpload(get('resume'), { name: 'alex.pdf' }), true);
  assert.equal(isResumeUpload(get('cv'), { name: 'alex.docx' }), true);
  assert.equal(isResumeUpload(get('generic'), { name: 'resume.txt' }), true);
  assert.equal(isResumeUpload(get('generic'), { name: 'other.pdf' }), false);
  assert.equal(isResumeUpload(get('cover'), { name: 'resume.pdf' }), false);
  assert.equal(isResumeUpload(get('certificate'), { name: 'resume.pdf' }), false);
  assert.equal(isResumeUpload(get('resume'), { name: 'resume.exe' }), false);
});

test('automatic reuse requires an application form and excludes account forms', () => {
  for (const [html, expected] of [
    ['<form><label>Resume<input type="file"></label><input name="email"></form>', true],
    ['<form><button>Submit application</button></form>', true],
    ['<form><input name="email"><button>Subscribe</button></form>', false],
    ['<form>Apply for this job<input type="password"></form>', false],
    ['<form>Contact us<input name="email"></form>', false],
  ]) assert.equal(isApplicationScope(new JSDOM(html).window.document.querySelector('form')), expected);
});
