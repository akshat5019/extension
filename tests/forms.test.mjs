import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { classifyField, describeField, writeField, profileValue } from '../src/forms.js';

test('recognizes representative Naukri, LinkedIn and career-site fields', () => {
  for (const [label, expected] of [['First name', 'firstName'], ['lastName', 'lastName'], ['Email address', 'email'], ['Mobile number', 'phone'], ['Current company', 'currentCompany'], ['LinkedIn profile', 'linkedin'], ['Current job title', 'jobTitle'], ['Postal code', 'postalCode'], ['University', 'school']]) assert.equal(classifyField(label), expected, label);
  assert.equal(classifyField('Applicant', 'section-personal given-name'), 'firstName');
  assert.equal(profileValue({ firstName: 'Akshat', lastName: 'Sharma' }, 'fullName'), 'Akshat Sharma');
});
test('never infers legal, salary, demographic, consent or credential questions', () => {
  for (const label of ['Email verification code', 'Are you authorized to work in this country?', 'Expected salary', 'Notice period', 'Years of experience', 'Gender', 'Agree to terms', 'Passport number', 'Birth date', 'Sponsorship required?', 'Why this company?']) assert.equal(classifyField(label, 'email', 'email'), null, label);
});
test('visible labels beat misleading machine names and ARIA labels are recognized', () => {
  const { window } = new JSDOM('<label for="email">Expected salary</label><input id="email" name="email"><span id="label">First name</span><input id="name" aria-labelledby="label">');
  assert.equal(describeField(window.document.getElementById('email')).key, null);
  assert.equal(describeField(window.document.getElementById('name')).key, 'firstName');
});
test('fills inputs with native events and matches select options exactly', () => {
  const { window } = new JSDOM('<input><select><option value="">Select</option><option value="IN">India</option><option disabled value="US">USA</option></select><input type="checkbox"><input type="file">');
  const [input, select, checkbox, file] = window.document.querySelectorAll('input,select');
  const events = [];
  input.addEventListener('input', () => events.push('input'));
  input.addEventListener('change', () => events.push('change'));
  assert.equal(writeField(input, 'Akshat'), true);
  assert.deepEqual(events, ['input', 'change']);
  assert.equal(writeField(select, 'india'), true);
  assert.equal(select.value, 'IN');
  assert.equal(writeField(select, 'USA'), false);
  assert.equal(writeField(select, 'Ind'), false);
  assert.equal(writeField(checkbox, 'yes'), false);
  assert.equal(writeField(file, 'resume.pdf'), false);
});
