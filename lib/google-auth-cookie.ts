import 'server-only';
import { cookieSecure } from '@/lib/session';

// The cookie carrying an authorization request's state, nonce and PKCE verifier from
// `/auth/google` to its callback (docs/multi-author-requirements.md §9.3). Scoped to that path and
// short-lived; `Lax` so the top-level redirect back from Google still sends it.
export const GOOGLE_AUTH_COOKIE = 'google_auth';
const GOOGLE_AUTH_COOKIE_PATH = '/auth/google';
// Long enough to pick an account and consent, short enough that a stale tab cannot finish.
const GOOGLE_AUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60;

export const googleAuthCookieOptions = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite: 'lax',
  path: GOOGLE_AUTH_COOKIE_PATH,
  maxAge: GOOGLE_AUTH_COOKIE_MAX_AGE_SECONDS,
} as const;

// Deleting must name the same path the cookie was set on.
export const googleAuthCookieDeletion = { name: GOOGLE_AUTH_COOKIE, path: GOOGLE_AUTH_COOKIE_PATH };
