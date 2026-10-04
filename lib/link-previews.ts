import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { linkPreviews } from './db/schema';
import { probeImage } from './link-image';
import { fetchLinkPreview, type LinkPreview } from './link-title';

// The stored half of an external link card (docs/link-card-requirements.md §14.3): what was read
// off the target page, and when.
//
// **The editor may fetch; the published page may not.** `readLinkPreview` is a SELECT only (§14.1);
// `resolveLinkPreview` is the editor's path and the only one reaching the network.

// About a week for a title: it rarely changes and the editor re-checks on every draw. A failure much
// sooner, since the typical one (a Cloudflare challenge) is about the request, not the page.
// `/api/link-title` splits its TTLs the same way.
const OK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAIL_TTL_MS = 30 * 60 * 1000;

// What this module knows how to read. **Bump it whenever that changes**: an older version's row is
// stale however fresh (§14.3.1). 1 added the image.
const PREVIEW_VERSION = 1;

// For the published page. `null` covers "never looked up" and "nothing to read", which render the
// same fallback (§6.1). No TTL here: a stale title beats no card.
export async function readLinkPreview(url: string): Promise<LinkPreview | null> {
  const [row] = await db.select().from(linkPreviews).where(eq(linkPreviews.url, url)).limit(1);
  // `partial` still makes a card; only the picture is missing. An older version's row is shown too,
  // since this page can't refresh it (§14.1); the editor re-reads it.
  if (!row || row.status === 'failed') return null;
  return { title: row.title, description: row.description, image: row.image };
}

// The editor's path: a fresh row, else read the page and store it. `null` when there is nothing to
// draw.
//
// `force` is the author's explicit 「カードにする」 after changing something on the other side
// (§14.3.2); the per-render lookup never passes it. **It refuses a remembered failure, not a
// remembered answer:** re-reading an `ok` page could only replace a good card with a failure.
export async function resolveLinkPreview(url: string, force = false): Promise<LinkPreview | null> {
  const [row] = await db.select().from(linkPreviews).where(eq(linkPreviews.url, url)).limit(1);
  // Only `ok` is settled; `partial`, `failed` and older-version rows are re-asked.
  const ttl = row?.status === 'ok' ? OK_TTL_MS : FAIL_TTL_MS;
  const fresh = row && row.version === PREVIEW_VERSION && Date.now() - row.fetchedAt < ttl;
  const usable = fresh && !(force && row.status !== 'ok');
  if (usable) {
    return row.status === 'failed'
      ? null
      : { title: row.title, description: row.description, image: row.image };
  }

  const fetched = await fetchLinkPreview(url);
  // Offered but unobtainable is `partial`, retried sooner than a page with no image.
  const image = fetched ? await usableImage(fetched.image) : '';
  const status = !fetched ? 'failed' : fetched.image && !image ? 'partial' : 'ok';
  await writeLinkPreview(url, fetched && { ...fetched, image }, status);
  return fetched && { ...fetched, image };
}

// An og:image is kept only if it can be served: a 404, a wrong type or an oversized file would be a
// broken picture in static HTML (§14.4). `probeImage` reads status, type and length and cancels the
// body. An image removed later still breaks until the editor refreshes the row.
async function usableImage(image: string): Promise<string> {
  if (!image) return '';
  return (await probeImage(image)) ? image : '';
}

// Failures are stored, so the next render doesn't immediately ask again.
async function writeLinkPreview(
  url: string,
  preview: LinkPreview | null,
  status: 'ok' | 'partial' | 'failed',
): Promise<void> {
  const values = {
    url,
    title: preview?.title ?? '',
    description: preview?.description ?? '',
    image: preview?.image ?? '',
    status,
    fetchedAt: Date.now(),
    version: PREVIEW_VERSION,
  };
  await db.insert(linkPreviews).values(values).onConflictDoUpdate({
    target: linkPreviews.url,
    set: values,
  });
}
