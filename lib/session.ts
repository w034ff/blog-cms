import 'server-only';
import { cookies } from 'next/headers';
import {
  decryptSession,
  encryptSession,
  SESSION_MAX_AGE_SECONDS,
  type SessionPayload,
} from '@/lib/session-token';
import { siteOrigin } from '@/lib/site';

const SESSION_COOKIE = 'session';

// Whether the session cookie carries `Secure`. Opt-in rather than derived, because
// the flag has to be false on a plain-HTTP LAN host, where a Secure cookie is simply
// never sent back and the login silently fails to stick.
export const cookieSecure = process.env.SESSION_COOKIE_SECURE === 'true';

// The one combination that is always a mistake: served over HTTPS, but handing out a
// session token without Secure, so any http:// request to the same host leaks it.
// SITE_ORIGIN and SESSION_COOKIE_SECURE are set independently of each other, and
// nothing else in the app would notice them disagreeing.
if (siteOrigin.protocol === 'https:' && !cookieSecure) {
  console.warn(
    `SITE_ORIGIN is ${siteOrigin.origin} but SESSION_COOKIE_SECURE is not "true" — the session cookie will be sent without Secure.`,
  );
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await encryptSession(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return decryptSession(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export type { SessionPayload };
