import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberAnswer, suggestedAnswer, canRemember } from '../src/answers.js';

test('remembered questions tolerate required markers but preserve meaning and website scope', () => {
  const field = { label: 'Expected salary *', type: 'text' };
  const saved = rememberAnswer({}, field, '1200000', 'https://www.naukri.com');
  assert.equal(suggestedAnswer(saved, { label: 'Expected salary (required)', type: 'text' }, 'https://www.naukri.com'), '1200000');
  assert.equal(suggestedAnswer(saved, { ...field, valid: false }, 'https://www.naukri.com'), '1200000');
  assert.equal(suggestedAnswer(saved, field, 'https://www.linkedin.com'), '');
  assert.equal(suggestedAnswer(saved, { label: 'Current salary', type: 'text' }, 'https://www.naukri.com'), '');
});
test('select answers use option meanings rather than stale portal values', () => {
  const field = { label: 'Authorized to work?', options: [{ value: '1', label: 'Yes' }, { value: '2', label: 'No' }] };
  const saved = rememberAnswer({}, field, '1', 'https://example.com');
  assert.equal(suggestedAnswer(saved, { ...field, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }, 'https://example.com'), 'yes');
  assert.equal(suggestedAnswer(saved, { ...field, options: [{ value: '1', label: 'No' }, { value: '2', label: 'Unsure' }] }, 'https://example.com'), '');
});
test('does not remember secrets, attachments, consent, invalid or ambiguous fields', () => {
  for (const field of [{ label: 'Password' }, { label: 'OTP' }, { label: 'Verification code' }, { label: 'Agree to terms' }, { label: 'Upload resume', type: 'file' }, { label: 'Salary', manual: true }, { label: 'Email', valid: false }, { label: 'textarea' }]) {
    assert.equal(canRemember(field), false);
    assert.deepEqual(rememberAnswer({}, field, 'secret', 'https://example.com'), {});
  }
});
test('updates remembered answers and bounds storage', () => {
  let saved = {};
  for (let i = 0; i < 105; i++) saved = rememberAnswer(saved, { label: `Question ${i}` }, 'x'.repeat(6000), 'https://example.com');
  assert.equal(Object.keys(saved).length, 100);
  assert.equal(Object.values(saved)[0].answer.length, 5000);
  saved = rememberAnswer(saved, { label: 'Question 104' }, 'updated', 'https://example.com');
  assert.equal(suggestedAnswer(saved, { label: 'Question 104' }, 'https://example.com'), 'updated');
});
