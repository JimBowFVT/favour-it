import { validateBirthDate } from './age';
const today = new Date('2026-09-07T00:00:00Z');
test('account age uses UTC birthdays, including the exact minimum birthday', () => {
  expect(validateBirthDate('2013-09-07', today)).toBe('2013-09-07');
  expect(() => validateBirthDate('2013-09-08', today)).toThrow('at least 13');
  expect(validateBirthDate('2000-02-29', today)).toBe('2000-02-29');
});
test.each(['', null, '2026-02-29', '1899-12-31', '2026-09-08', '01/01/2000'])('rejects malformed or impossible birth date %s', value => {
  expect(() => validateBirthDate(value, today)).toThrow();
});
