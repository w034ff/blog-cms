import 'server-only';
import { hashEmailWithSecret } from '@/lib/email-hash-rules';

// The stored form of an email (docs/multi-author-requirements.md §10.3). The key comes from
// SESSION_SECRET rather than another secret: losing or rotating it breaks only the admin's lookup,
// since sign-in goes by `google_sub`.
export function hashEmail(email: string): string {
  return hashEmailWithSecret(process.env.SESSION_SECRET ?? '', email);
}
