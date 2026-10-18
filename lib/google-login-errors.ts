// Why a Google sign-in came back to /login, as the `?error=` value, and what the page says for each
// (docs/multi-author-requirements.md §9.6). Pure, so the login page can read it.

export const SUSPENDED_MESSAGE = 'このアカウントは停止されています。';

export const GOOGLE_LOGIN_ERROR_MESSAGES = {
  not_invited: 'このメールアドレスは招待されていません。',
  suspended: SUSPENDED_MESSAGE,
  unverified: 'Google のメールアドレスが確認されていません。',
  failed: 'Google でのログインに失敗しました。もう一度お試しください。',
} as const;

export type GoogleLoginError = keyof typeof GOOGLE_LOGIN_ERROR_MESSAGES;

// The message for a `?error=` value, or null for none or one this page never sends.
export function googleLoginErrorMessage(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const entry = Object.entries(GOOGLE_LOGIN_ERROR_MESSAGES).find(([code]) => code === value);
  return entry ? entry[1] : null;
}
