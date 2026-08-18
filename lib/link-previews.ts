import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { linkPreviews } from './db/schema';
import { probeImage } from './link-image';
import { fetchLinkPreview, type LinkPreview } from './link-title';

// The stored half of an external link card (docs/link-card-requirements.md §14.3): what was read
// off the target page, and when.
//
// **Two callers, two different rules, and the difference is the point.** The editor may fetch; the
// published page may not. `readLinkPreview` is a SELECT and nothing else, so a reader's request
// touches SQLite and stops there (§14.1). `resolveLinkPreview` is the editor's path and is the
// only one that can reach the network.

// A title is worth re-reading about once a week: they change rarely, and the row is re-checked
// every time a NodeView draws the card, so a short TTL buys nothing but requests to other people's
// servers. A failure is re-checked far sooner — the measured failure is a Cloudflare challenge
// (403 on `www.npmjs.com`, 2026-08-18), which is a property of the request rather than of the
// page, and remembering it for a week would leave a card that could resolve today showing as a
// plain link. `/api/link-title` splits its own TTLs for the same reason and by the same ratio.
const OK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAIL_TTL_MS = 30 * 60 * 1000;

// What this module knows how to read. **Bump it whenever that changes** — a row written by an older
// version is stale however fresh its timestamp is, and without this there is no way to say so
// (§14.3.1).
//
// 1 (2026-08-18): title, description and the og:image reference. Rows at 0 were written in the
// hours before the image column existed and would otherwise have sat picture-less for a week.
const PREVIEW_VERSION = 1;

// What the published page gets. `null` covers "never looked up" and "looked up and there was
// nothing to read" alike, because the page does the same thing for both: render the plain-link
// fallback (§6.1). It deliberately does NOT consult the TTL — a stale title is a better card than
// no card, and the only thing a reader could gain from the expiry is a slower page.
export async function readLinkPreview(url: string): Promise<LinkPreview | null> {
  const [row] = await db.select().from(linkPreviews).where(eq(linkPreviews.url, url)).limit(1);
  // `partial` is a card too — it has a title and a description, and only the picture is missing.
  // Refusing it would drop the whole card to a plain link over an image that may never exist.
  //
  // An older version's row is still shown rather than dropped: what it holds is what the reader
  // would have got yesterday, and the published page has no way to refresh it (§14.1). The editor
  // is what re-reads it, and it does so on the next render.
  if (!row || row.status === 'failed') return null;
  return { title: row.title, description: row.description, image: row.image };
}

// The editor's path: answer from the table while the row is fresh, otherwise read the page again
// and write what came back. Returns what the card should draw, `null` when there is nothing to
// draw — the caller falls back to showing the URL itself.
export async function resolveLinkPreview(url: string): Promise<LinkPreview | null> {
  const [row] = await db.select().from(linkPreviews).where(eq(linkPreviews.url, url)).limit(1);
  // `ok` is the only settled answer. `partial` and `failed` are re-asked far sooner, and a row from
  // an older version is not used at all — its age says nothing about whether it holds what this
  // version would have stored.
  const ttl = row?.status === 'ok' ? OK_TTL_MS : FAIL_TTL_MS;
  const usable = row && row.version === PREVIEW_VERSION && Date.now() - row.fetchedAt < ttl;
  if (usable) {
    return row.status === 'failed'
      ? null
      : { title: row.title, description: row.description, image: row.image };
  }

  const fetched = await fetchLinkPreview(url);
  // Whether the page offered an image is not the same question as whether one could be had, and
  // the two want different retry intervals — hence `partial` rather than an empty `ok`.
  const image = fetched ? await usableImage(fetched.image) : '';
  const status = !fetched ? 'failed' : fetched.image && !image ? 'partial' : 'ok';
  await writeLinkPreview(url, fetched && { ...fetched, image }, status);
  return fetched && { ...fetched, image };
}

// An og:image URL is kept only if it can actually be served. The page's own claim is not enough:
// measured values point at other people's CDNs, and one that answers 404, or a type this site would
// not accept, or something over the cap becomes a broken picture on the published page — where
// nothing can react to it, because the card is static HTML by then (§14.4).
//
// So it is asked once, here, while the author is present and the answer is still cheap to act on.
// `probeImage` reads the status, the type and the declared length and cancels the body unread — a
// yes/no does not need the megabytes, and /api/link-image asks the real question later anyway.
//
// **A target that removes its image after this runs still leaves a broken picture on the published
// page**, and nothing there can react to it (the card is static HTML by then). It clears itself the
// next time the row is refreshed in the editor, which is the same TTL everything else here uses.
async function usableImage(image: string): Promise<string> {
  if (!image) return '';
  return (await probeImage(image)) ? image : '';
}

// Failures are stored, not skipped. A row saying "this one could not be read" is what keeps the
// next render from asking again immediately, and it is why `status` exists rather than being
// inferred from an empty title.
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
