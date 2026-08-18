import { fetchGuarded, readCapped, type Deps } from './guarded-fetch';

// What is read out of a page the author linked to. Two callers want different amounts: the link
// bubble wants the title for its top line (docs/link-requirements.md §5.5.10), and an external link
// card wants the title, the description and the image (docs/link-card-requirements.md §14.5).
//
// **The fetching is not here** — lib/guarded-fetch.ts owns it, and owns the address guard with it.
// This file is the extractors and two thin wrappers, so all of it can be tested without a server
// or a network. Storage is not here either: a Map that lives as long as the process
// (app/api/link-title/route.ts) and a table the published page reads (lib/link-previews.ts) are
// not the same thing, and §14.5 keeps them apart on purpose.

// Enough of a page to hold <head>. The tags live near the top — measured 2026-08-18: on all ten
// sites probed, every og: tag present was inside the first 64KB, while only two of the pages were
// that small in total.
const MAX_BYTES = 64 * 1024;
// Third-party text arriving in the editor's DOM. React escapes it, so the concern is layout rather
// than injection: an unbounded title reflows the card.
export const TITLE_MAX_LENGTH = 120;
// The card's description is clamped to two lines by CSS (`.prose .link-card-description`), so this
// is not a display limit — it bounds what is stored of a third party's page.
export const DESCRIPTION_MAX_LENGTH = 200;

// og:title first: it is what the page wants to be called when quoted, which is what this is.
// Falls back to <title>, which every one of the pages measured 2026-08-16 carried.
export function extractTitle(html: string): string | null {
  const og =
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html)?.[1];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return normalizeTitle(og ?? title ?? '');
}

// og:description first for the same reason og:title is preferred: it is the page's own summary of
// itself. `<meta name="description">` is the fallback and is not a rare one — measured 2026-08-18,
// og:description alone covers 4 of 10 sites and the pair covers 6 (docs/link-card-requirements.md
// §14.4). Two of the ten have neither, and their cards are one line, which the card already draws.
export function extractDescription(html: string): string | null {
  const og =
    /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:description["']/i.exec(html)?.[1];
  const name =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']description["']/i.exec(html)?.[1];
  return normalizeText(og ?? name ?? '', DESCRIPTION_MAX_LENGTH);
}

// og:image, resolved against the page it was read from. Measured 2026-08-18: 6 of 10 sites carry
// one, and every value seen was already absolute and on a third party's CDN (`res.cloudinary.com`,
// `opengraph.githubassets.com`, `cdn.qiita.com`, `upload.wikimedia.org`). Resolved anyway, because
// the spec permits a relative value and a card built on a half-URL would simply never load.
//
// twitter:image is not consulted. It is the same picture on every page measured, and a second
// source is a second thing to keep in step for no measured gain.
export function extractImage(html: string, pageUrl: string): string | null {
  const raw =
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i.exec(html)?.[1];
  if (!raw) return null;
  let absolute: URL;
  try {
    absolute = new URL(raw.trim(), pageUrl);
  } catch {
    return null;
  }
  // The proxy will only ever fetch http(s), so a `data:` or `//` value that cannot become one is
  // stored as nothing rather than as a reference that fails later, off in another module.
  if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return null;
  return absolute.toString();
}

export function normalizeTitle(raw: string): string | null {
  return normalizeText(raw, TITLE_MAX_LENGTH);
}

function normalizeText(raw: string, max: number): string | null {
  const text = raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// What an external link card is made of. `description` is '' rather than null when the page has
// none: the card omits the line either way, and a nullable field would have to be flattened again
// at the column, which is `NOT NULL DEFAULT ''` (lib/db/schema.ts).
export type LinkPreview = { title: string; description: string; image: string };

// null means "no title to show" for every reason there is — refused scheme, blocked address, a
// status that is not 2xx, a body that is not HTML, a timeout, no <title>. The caller has exactly
// one fallback (keep showing the URL), so distinguishing them here would buy nothing.
export async function fetchLinkTitle(
  href: string,
  deps: Partial<Deps> = {},
): Promise<string | null> {
  const html = await fetchPageHtml(href, deps);
  return html === null ? null : extractTitle(html);
}

// Same fetch, read further. null for every reason above plus "the page has no title at all": the
// card's first line is the title, and a card whose first line is the URL it already stores is what
// the caller draws when this returns null (§14.7). A page with a title and neither a description
// nor an image is a perfectly good preview and comes back with those as ''.
export async function fetchLinkPreview(
  href: string,
  deps: Partial<Deps> = {},
): Promise<LinkPreview | null> {
  const html = await fetchPageHtml(href, deps);
  if (html === null) return null;
  const title = extractTitle(html);
  if (title === null) return null;
  return {
    title,
    description: extractDescription(html) ?? '',
    // The og:image URL as the page gives it, absolute. Nothing has been fetched from it yet — the
    // caller decides whether it is worth keeping (lib/link-previews.ts) and the proxy decides what
    // may come back (lib/link-image.ts). Stored raw because the signed proxy path is derived from
    // it, and deriving twice from one stored value cannot drift.
    image: extractImage(html, href) ?? '',
  };
}

// The page as text. A body that is not HTML is not a page this reads: an image or a PDF has no
// <title>, and decoding megabytes of it to find that out is the download the cap exists to avoid.
// Decoded as UTF-8 — all ten pages measured 2026-08-16 declared it, so charset negotiation would be
// machinery with nothing to do.
async function fetchPageHtml(href: string, deps: Partial<Deps>): Promise<string | null> {
  const response = await fetchGuarded(href, 'text/html', deps);
  if (!response) return null;
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) return null;
  return new TextDecoder('utf-8').decode(await readCapped(response, MAX_BYTES));
}
