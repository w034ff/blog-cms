import 'server-only';
import { cache } from 'react';
import { connection } from 'next/server';
import { inArray } from 'drizzle-orm';
import {
  DEFAULT_SITE_DESCRIPTION,
  DEFAULT_SITE_NAME,
  type SiteIdentity,
} from '@/app/shared-metadata';
import { db } from '@/lib/db';
import { appSettings } from '@/lib/db/schema';
import {
  SITE_DESCRIPTION_KEY,
  SITE_NAME_KEY,
  SITE_SHARE_IMAGE_KEY,
} from '@/lib/site-settings-rules';

// The site's name, description and share image as an admin last saved them, else the defaults
// (docs/site-settings-requirements.md §2). Synchronous and request-free, for tests and callers
// outside a render; pages read `getSiteIdentity`.
export function readSiteIdentity(): SiteIdentity {
  const rows = db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, [SITE_NAME_KEY, SITE_DESCRIPTION_KEY, SITE_SHARE_IMAGE_KEY]))
    .all();
  const saved = new Map(rows.map((row) => [row.key, row.value]));
  return {
    name: saved.get(SITE_NAME_KEY) ?? DEFAULT_SITE_NAME,
    description: saved.get(SITE_DESCRIPTION_KEY) ?? DEFAULT_SITE_DESCRIPTION,
    shareImage: saved.get(SITE_SHARE_IMAGE_KEY) ?? '',
  };
}

// Once per render. `connection()` first: better-sqlite3 answers synchronously, so without it a
// prerendered route (/login) would bake the name in at build time and never see a saved one.
export const getSiteIdentity = cache(async (): Promise<SiteIdentity> => {
  await connection();
  return readSiteIdentity();
});

// Every key in one transaction, so a page never reads a new name beside an old description.
// Takes values `validateSiteIdentity` already accepted; it checks nothing itself.
export function saveSiteIdentity(identity: SiteIdentity): void {
  const entries: [string, string][] = [
    [SITE_NAME_KEY, identity.name],
    [SITE_DESCRIPTION_KEY, identity.description],
    [SITE_SHARE_IMAGE_KEY, identity.shareImage],
  ];
  db.transaction((tx) => {
    for (const [key, value] of entries) {
      tx.insert(appSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value } })
        .run();
    }
  });
}
