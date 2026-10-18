import { createHmac, hkdfSync } from 'node:crypto';
import { normalizeEmail } from './author-access-rules';

// The HKDF `info` that separates this key from the session key it is derived from. Changing it
// re-keys every stored hash, which heals as each author next signs in (§10.3).
const EMAIL_HASH_KEY_INFO = 'blog-cms email lookup v1';
const KEY_BYTES = 32;

// HMAC-SHA256 of the normalized address, hex, under a key derived from `secret`
// (docs/multi-author-requirements.md §10.3). Pure and free of `server-only`, so the E2E harness can
// seed a row the app will match; the app calls it through lib/email-hash.ts.
export function hashEmailWithSecret(secret: string, email: string): string {
  // An empty key would make the hash a plain one, which a list of guessed addresses reverses.
  if (!secret) throw new Error('SESSION_SECRET is not set');
  const key = Buffer.from(hkdfSync('sha256', secret, '', EMAIL_HASH_KEY_INFO, KEY_BYTES));
  return createHmac('sha256', key).update(normalizeEmail(email)).digest('hex');
}
