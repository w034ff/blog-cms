// What a link card's `data-href` may be, and how a URL becomes one
// (docs/link-card-requirements.md §14.2, §14.5.1).
//
// Shared by the resolve stage (lib/rehype-link-card.ts) and the editor
// (components/editor/link-card-extension.ts, LinkBubble.tsx), so the editor never makes a card the
// published side refuses. No DOM or DB, so both can import it.

// `/posts/<slug>`, the internal half. Wider than the 20-hex slugs (lib/slug.ts), since two old posts
// are `hello-world` and `second-post`. **No `:` can appear**, so no scheme is representable, and the
// `/posts/` prefix keeps it same-origin (`//evil.example` fails too). The first character excludes
// `.`, so `..` (the site root) can't pose as a post.
const INTERNAL_CARD_HREF = /^\/posts\/[\w~-][\w.~-]*$/;

// The external half: an allowlist of two schemes, since the resolve stage runs after sanitize and
// its `<a href>` meets no further check (§4.4). `new URL()` parses, which a prefix test would get
// wrong for whitespace and entity forms of `javascript:`. The return value is the card's host line
// (§14.4), from the same parse; `www.` is dropped as an address bar does.
export function externalCardHost(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // No credentials: they would be sent by the preview fetch and published in the `<a href>`.
  if (url.username !== '' || url.password !== '') return null;
  return url.hostname.replace(/^www\./, '');
}

export function isCardHref(href: string): boolean {
  return INTERNAL_CARD_HREF.test(href) || externalCardHost(href) !== null;
}

// The reference to store for a URL, or null for no card. **This blog's own post URL becomes the
// internal reference** (§14.5.1): an internal card reads `posts` live, and an external one would need
// the server to fetch its own public URL, which the title route refuses. An own-origin URL naming
// no post is null: neither kind of card can hold it.
export function normalizeCardHref(raw: string, origin: string): string | null {
  const value = raw.trim();
  if (value === '') return null;
  if (INTERNAL_CARD_HREF.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.origin !== origin) return url.toString();
  const slug = /^\/posts\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  if (!slug) return null;
  // `decodeURIComponent` throws on `%zz`, which `new URL()` keeps; unguarded, it would take down the
  // whole published page through rehypeLinkCard's `Promise.all`. A bad escape names no post.
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const internal = `/posts/${decoded}`;
  return INTERNAL_CARD_HREF.test(internal) ? internal : null;
}

// Does this normalized reference (`/posts/<slug>`) point at the post open in the editor (§18)? Its
// own predicate, because `lookupCard` falls back to the raw reference when `normalizeCardHref` is
// null, which would make a rule inside it a silent no-op. Every entry point asks explicitly. An
// empty `ownSlug` (no row yet) is never a self.
export function isOwnPostHref(href: string, ownSlug: string): boolean {
  return ownSlug !== '' && href === `/posts/${ownSlug}`;
}
