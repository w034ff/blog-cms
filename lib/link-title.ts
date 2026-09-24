import { fetchGuarded, readCapped, type Deps } from './guarded-fetch';

// What is read out of a page the author linked to. Two callers want different amounts: the link
// bubble wants the title for its top line (docs/link-requirements.md §5.5.10), and an external link
// card wants the title, the description and the image (docs/link-card-requirements.md §14.5).
//
// **The fetching is not here** (lib/guarded-fetch.ts owns it and the address guard), so these
// extractors test without a network. Storage isn't either: the title route's process Map and the
// published page's table (lib/link-previews.ts) are kept apart on purpose (§14.5).

// Enough of a page to hold <head>: og: tags sit within the first 64KB on the pages probed.
const MAX_BYTES = 64 * 1024;
// Third-party text arriving in the editor's DOM. React escapes it, so the concern is layout rather
// than injection: an unbounded title reflows the card.
export const TITLE_MAX_LENGTH = 120;
// The card's description is clamped to two lines by CSS (`.prose .link-card-description`), so this
// is not a display limit — it bounds what is stored of a third party's page.
export const DESCRIPTION_MAX_LENGTH = 200;

// og:title first (what the page wants to be called when quoted), then <title>.
export function extractTitle(html: string): string | null {
  const og =
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html)?.[1];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return normalizeTitle(og ?? title ?? '');
}

// og:description first, for og:title's reason; `<meta name="description">` is a common fallback
// (docs/link-card-requirements.md §14.4). Without either, the card is one line.
export function extractDescription(html: string): string | null {
  const og =
    /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:description["']/i.exec(html)?.[1];
  const name =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']description["']/i.exec(html)?.[1];
  return normalizeText(og ?? name ?? '', DESCRIPTION_MAX_LENGTH);
}

// og:image, resolved against the page: observed values are absolute, but the spec permits relative.
// twitter:image is not consulted: the same picture, a second source to keep in step.
export function extractImage(html: string, pageUrl: string): string | null {
  const raw =
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i.exec(html)?.[1];
  if (!raw) return null;
  // **Entity-decoded first, as the text is:** an attribute carries `&amp;` for `&`, and hosts that
  // validate their query (imgix `s=`, `/_next/image`) refuse the undecoded `amp;w`.
  let absolute: URL;
  try {
    absolute = new URL(decodeEntities(raw).trim(), pageUrl);
  } catch {
    return null;
  }
  // The proxy only fetches http(s); anything else is stored as nothing, not a later failure.
  if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return null;
  return absolute.toString();
}

export function normalizeTitle(raw: string): string | null {
  return normalizeText(raw, TITLE_MAX_LENGTH);
}

// Shared with `extractImage`, which needs the decode but not the whitespace collapse or length cap
// (docs/link-card-requirements.md §14.5.3). One pass per entity, `&amp;` first, so `&amp;amp;`
// decodes exactly once, as an HTML parser would.
function decodeEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function normalizeText(raw: string, max: number): string | null {
  const text = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// An external card's parts. `description` is '' rather than null, matching the `NOT NULL DEFAULT ''`
// column (lib/db/schema.ts); the card omits the line either way.
export type LinkPreview = { title: string; description: string; image: string };

// null for every reason (scheme, address, status, not HTML, timeout, no <title>): the caller's one
// fallback is to keep showing the URL.
export async function fetchLinkTitle(
  href: string,
  deps: Partial<Deps> = {},
): Promise<string | null> {
  const html = await fetchPageHtml(href, deps);
  return html === null ? null : extractTitle(html);
}

// Same fetch, read further. null also when the page has no title: a URL-only card is the caller's
// fallback (§14.7). Missing description or image come back as ''.
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
    // The og:image as given, unfetched: lib/link-previews.ts decides whether to keep it and
    // lib/link-image.ts what may come back. Stored raw; the signed path is derived from it.
    image: extractImage(html, href) ?? '',
  };
}

// The page as text. Non-HTML bodies are not read (no <title>, and the cap exists to avoid the
// download). UTF-8 only: every page measured declared it.
async function fetchPageHtml(href: string, deps: Partial<Deps>): Promise<string | null> {
  const response = await fetchGuarded(href, 'text/html', deps);
  if (!response) return null;
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) return null;
  return new TextDecoder('utf-8').decode(await readCapped(response, MAX_BYTES));
}
