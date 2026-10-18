import { describe, expect, it } from 'vitest';
import { GOOGLE_LOGIN_ERROR_MESSAGES, googleLoginErrorMessage } from './google-login-errors';

describe('googleLoginErrorMessage (docs/multi-author-requirements.md §9.6, criterion 19)', () => {
  it.each(Object.entries(GOOGLE_LOGIN_ERROR_MESSAGES))('maps %s', (code, message) => {
    expect(googleLoginErrorMessage(code)).toBe(message);
  });

  it.each([undefined, '', 'email_taken', 'toString', ['failed']])('ignores %j', (value) => {
    expect(googleLoginErrorMessage(value)).toBeNull();
  });
});
