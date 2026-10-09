import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findScope, submissionReadiness } from '../src/submission.js';

function page(html) {
  const { window } = new JSDOM(html);
  window.Element.prototype.getClientRects = () => [{ width: 100, height: 20 }];
  return window.document;
}

test('pauses for required answers, invalid values and required labels even when optional blanks are allowed', () => {
  const doc = page('<form><label>Email<input type="email" required value="invalid"></label><label>Salary *<input id="salary"></label><button>Submit application</button></form>');
  const scope = findScope(doc);
  assert.equal(submissionReadiness(doc, scope, true).ready, false);
  assert.equal(submissionReadiness(doc, scope, true).missing.length, 2);
  doc.querySelector('input').value = 'person@example.com';
  doc.querySelector('#salary').value = '1000000';
  assert.equal(submissionReadiness(doc, scope, true).ready, true);
});

test('radio groups accept a selected alternative while optional unanswered questions need explicit skipping', () => {
  const doc = page('<form><label>Yes<input type="radio" name="authorized" required></label><label>No<input type="radio" name="authorized" checked></label><label>Website<input></label><button>Submit application</button></form>');
  const scope = findScope(doc);
  assert.equal(submissionReadiness(doc, scope).missing.length, 1);
  assert.equal(submissionReadiness(doc, scope, true).ready, true);
});

test('does not confuse Next with Submit and rejects ambiguous submit buttons or application forms', () => {
  const doc = page('<form><input value="Akshat"><button>Next</button></form>');
  assert.equal(submissionReadiness(doc, findScope(doc)).ready, false);
  doc.querySelector('button').textContent = 'Submit application';
  assert.equal(submissionReadiness(doc, findScope(doc)).ready, true);
  doc.querySelector('form').append(doc.querySelector('button').cloneNode(true));
  assert.equal(submissionReadiness(doc, findScope(doc)).ready, false);
  doc.body.innerHTML = '<form><input></form><form><input></form>';
  assert.equal(findScope(doc), null);
});

test('requires manual submission for custom controls, CAPTCHA and disabled Submit', () => {
  for (const extra of ['<div role="combobox"></div>', '<div role="radio"></div>', '<iframe></iframe>', '<input type="password">', '<div class="g-recaptcha"></div>', '<input aria-invalid="true" value="error">']) {
    const doc = page(`<form><input value="Akshat">${extra}<button>Submit application</button></form>`);
    assert.equal(submissionReadiness(doc, findScope(doc), true).ready, false, extra);
  }
  const doc = page('<form><input value="Akshat"><button disabled>Submit application</button></form>');
  assert.equal(submissionReadiness(doc, findScope(doc)).ready, false);
});
