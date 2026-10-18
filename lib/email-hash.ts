import 'server-only';
import { createHmac, hkdfSync } from 'node:crypto';
import { normalizeEmail } from '@/lib/author-access-rules';

// The HKDF `info` that separates this key from the session key it is derived from. Changing it
// re-keys every stored hash, which heals as each author next signs in (§10.3).
const EMAIL_HASH_KEY_INFO = 'blog-cms email lookup v1';
const KEY_BYTES = 32;

// A key for email hashes, derived from SESSION_SECRET rather than held as another secret
// (docs/multi-author-requirements.md §10.3). Losing or rotating it breaks only the admin's lookup:
// sign-in goes by `google_sub`.
function emailHashKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  // An empty key would make the hash a plain one, which a list of guessed addresses reverses.
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return Buffer.from(hkdfSync('sha256', secret, '', EMAIL_HASH_KEY_INFO, KEY_BYTES));
}

// The stored form of an email: HMAC-SHA256 of the normalized address, hex.
export function hashEmail(email: string): string {
  return createHmac('sha256', emailHashKey()).update(normalizeEmail(email)).digest('hex');
}
