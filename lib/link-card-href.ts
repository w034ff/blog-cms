// What a link card's `data-href` may be, and how a URL becomes one
// (docs/link-card-requirements.md §14.2, §14.5.1).
//
// Shared rather than duplicated: the resolve stage decides whether a stored reference becomes a
// card (lib/rehype-link-card.ts), and the editor decides whether a URL the author typed or pasted
// can become one (components/editor/link-card-extension.ts, LinkBubble.tsx). A card the editor
// makes that the published side refuses is the one disagreement worth engineering against, so both
// sides ask the same functions. Nothing here touches the DOM or the DB, so both can import it.

// `/posts/<slug>`, the internal half. Slugs are the 20 hex chars generateUniqueSlug() produces
// (lib/slug.ts), but the class is left wider than that: the two posts predating the opaque-slug
// rework are still `hello-world` and `second-post`, and a card pointing at one of those is a
// legitimate reference. What matters is that no `:` can appear, so `javascript:` and every other
// scheme is unrepresentable, and that the leading `/posts/` keeps it same-origin and relative — a
// `//evil.example` protocol-relative URL fails the same test.
//
// The first character excludes `.` so the slug can't be `..` or `.`: those pass a plain `[\w.~-]+`
// and resolve, in a browser, to somewhere other than a post (`/posts/..` is the site root).
// Harmless — still same-origin — but a reference that doesn't name a post has no business becoming
// a link that claims to.
const INTERNAL_CARD_HREF = /^\/posts\/[\w~-][\w.~-]*$/;

// The external half. An allowlist of two schemes rather than a blocklist of bad ones, because the
// resolve stage runs after rehype-sanitize: what it accepts becomes an `<a href>` with no further
// check anywhere (§4.4). `new URL()` does the parsing — a prefix test on the string would be fooled
// by the whitespace and entity forms a browser still resolves as `javascript:`, and it also
// rejects for free everything with no scheme at all.
//
// The return value is what an external card's bottom line shows (§14.4), so the check and the line
// cannot disagree about which host a reference points at: there is one parse and the line is drawn
// from it. `www.` is dropped for the reason a browser's address bar drops it — it distinguishes
// nothing.
export function externalCardHost(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // No credentials in a card's reference. `https://user:pass@host/` parses, and left alone it would
  // be sent to the target by the preview fetch and published verbatim inside an `<a href>` for
  // every reader to see. A card names a page; it is not a place to carry a secret.
  if (url.username !== '' || url.password !== '') return null;
  return url.hostname.replace(/^www\./, '');
}

export function isCardHref(href: string): boolean {
  return INTERNAL_CARD_HREF.test(href) || externalCardHost(href) !== null;
}

// The reference to store for a URL the author handed over, or null when there is no card to make.
//
// **A URL pointing at this blog's own post becomes the internal reference**, not an external card
// (§14.5.1). The two are not interchangeable: an internal card reads `posts` live, so it follows a
// renamed title and warns about a draft, while an external one would be a stored snapshot of the
// same row — and the server would have to fetch its own public URL back through the Funnel to take
// that snapshot, which is the one request app/api/link-title/route.ts already refuses to make.
//
// An own-origin URL that does not name a post returns null. It cannot be an internal card (there is
// no post) and must not be an external one (the preview route will not fetch this host), so the
// only thing left is to refuse before a card exists rather than after it fails to resolve.
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
  // `decodeURIComponent` throws on a malformed escape (`%zz`), and `new URL()` does not normalize
  // those away — `https://…/posts/%zz` arrives here with the pathname intact. Left unguarded the
  // throw reaches `resolveCard` inside rehypeLinkCard's `Promise.all`, which takes the whole
  // published page down rather than the one card, and the editor's NodeView with it. A slug that
  // is not valid percent-encoding names no post, so it is the same answer as any other miss.
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const internal = `/posts/${decoded}`;
  return INTERNAL_CARD_HREF.test(internal) ? internal : null;
}

// Does this reference point at the post that is open in the editor (§18)?
//
// A predicate of its own rather than a rule inside `normalizeCardHref`, and that is the whole
// reason it exists separately: `lookupCard` reads `normalizeCardHref(href, origin) ?? href`, so a
// null from there falls through to the raw reference and resolves as an ordinary internal card —
// the guard would be a silent no-op at the one door it most needs to hold. Every entry point asks
// this question explicitly instead.
//
// The argument is a normalized reference (`/posts/<slug>`), which is what all four callers have:
// three pass `normalizeCardHref`'s answer and the picker's list builds `/posts/${post.slug}` itself.
//
// An empty `ownSlug` is always false. A post with no row yet has no address to point at, so there
// is no self to reference — the question does not arise rather than being answered "no" by luck.
export function isOwnPostHref(href: string, ownSlug: string): boolean {
  return ownSlug !== '' && href === `/posts/${ownSlug}`;
}
