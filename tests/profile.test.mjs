import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResume } from '../src/profile.js';

test('extracts contact details and labelled values without guessing salary or legal answers', () => {
  const profile = parseResume('Akshat Sharma\nSoftware Engineer\nakshat@example.com\n+91 98765 43210\nlinkedin.com/in/akshat\ngithub.com/akshat5019\nCity: Bengaluru\nSkills: JavaScript, React\nSalary: 1000000\nWork authorized: Yes');
  assert.deepEqual(profile, { firstName: 'Akshat', lastName: 'Sharma', email: 'akshat@example.com', phone: '+91 98765 43210', linkedin: 'https://linkedin.com/in/akshat', github: 'https://github.com/akshat5019', city: 'Bengaluru', skills: 'JavaScript, React' });
});
test('leaves ambiguous name and employer blank, accepts Indian mobile without spaces', () => {
  const profile = parseResume('RESUME\nSoftware Engineer\n9876543210\nExperience\nExample Corp 2021-2024');
  assert.equal(profile.firstName, undefined);
  assert.equal(profile.currentCompany, undefined);
  assert.equal(profile.phone, '9876543210');
});
