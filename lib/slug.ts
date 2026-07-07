import 'server-only';
import { randomBytes } from 'node:crypto';
import { slugExists } from '@/lib/posts-write';

// Every post's public URL is an auto-assigned opaque slug: 20 hex chars (80 bits
// of full entropy from crypto.randomBytes — not a UUID, whose fixed version and
// variant nibbles would waste ~6 bits). Assigned once at row creation and never
// shown or edited by the author, so the URL is also unguessable (a forward-looking
// property for future unlisted posts). Retried on the astronomically unlikely
// chance of a collision.
export function generateUniqueSlug(): string {
  let slug = randomBytes(10).toString('hex');
  while (slugExists(slug)) {
    slug = randomBytes(10).toString('hex');
  }
  return slug;
}
