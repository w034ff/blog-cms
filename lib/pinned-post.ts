import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appSettings } from '@/lib/db/schema';

// The post an admin pinned to the top of the home page (docs/home-requirements.md §3). A row in
// `app_settings` rather than a column on `posts`: there is one pin for the whole site, it is the
// admin's as the site's name is, and no table has to be rebuilt.
export const PINNED_POST_KEY = 'pinned_post_id';

// The id as saved, or null. Whether that post may still be shown is the reader's question
// (lib/post-list.ts `splitPinned`), so an id left behind by a deleted or unpublished post is
// harmless here.
export function readPinnedPostId(): number | null {
  const row = db.select().from(appSettings).where(eq(appSettings.key, PINNED_POST_KEY)).get();
  if (!row) return null;
  const id = Number(row.value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// null takes the pin off. Takes an id the caller has already checked against the listed posts.
export function savePinnedPostId(id: number | null): void {
  if (id === null) {
    db.delete(appSettings).where(eq(appSettings.key, PINNED_POST_KEY)).run();
    return;
  }
  const value = String(id);
  db.insert(appSettings)
    .values({ key: PINNED_POST_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}
