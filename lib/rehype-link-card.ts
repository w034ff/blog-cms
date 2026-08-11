import type { Root, Element, ElementContent } from 'hast';
import type { VFile } from 'vfile';
import { visit } from 'unist-util-visit';

// What a card resolves to. Deliberately the shape the card renders, not a `Post`: lib/render.ts
// must not import the DB or its types (docs/link-card-requirements.md §6), so the caller —
// app/posts/[slug]/page.tsx — is what knows about `posts`, and a test can hand over a literal.
export type CardTarget = { title: string; date: string; description: string };
export type ResolveCard = (href: string) => Promise<CardTarget | null>;

declare module 'vfile' {
  interface DataMap {
    resolveCard: ResolveCard;
  }
}

// The stored form carries a reference and nothing else (§4.2), so `data-href` is the whole of what
// an author can write into a card — and it is NOT value-checked on the way in. `className` passes
// rehype-sanitize as a value allowlist, but `data-href` is a bare property name, so once it is
// allowed at all any value rides through; and this stage runs *after* sanitize, so the `<a href>`
// built below never meets its protocol check either (§4.4). Hence the shape test here, and hence
// it is a whitelist of one form rather than a blacklist of bad protocols.
//
// `/posts/<slug>`, matching the only thing a card may point at while external cards are deferred
// (§8). Slugs are the 20 hex chars generateUniqueSlug() produces (lib/slug.ts), but the class is
// left wider than that: the two posts predating the opaque-slug rework are still `hello-world` and
// `second-post`, and a card pointing at one of those is a legitimate reference. What matters is
// that no `:` can appear, so `javascript:` and every other scheme is unrepresentable, and that the
// leading `/posts/` keeps it same-origin and relative — a `//evil.example` protocol-relative URL
// fails the same test.
//
// The first character excludes `.` so the slug can't be `..` or `.`: those pass a plain
// `[\w.~-]+` and resolve, in a browser, to somewhere other than a post (`/posts/..` is the site
// root). Harmless — still same-origin — but a reference that doesn't name a post has no business
// becoming a link that claims to.
const CARD_HREF = /^\/posts\/[\w~-][\w.~-]*$/;

function hasClass(node: Element, name: string): boolean {
  const className = node.properties.className;
  return Array.isArray(className) && className.includes(name);
}

// The resolved card. Every class here is invented by this stage, which runs after sanitize, so
// none of it needs allow-listing — the same position (and the same reason) rehype-pretty-code's
// own spans rely on. `<a>` wraps the whole card so the entire block is one click target.
function cardElement(href: string, target: CardTarget): Element {
  const parts: Element[] = [
    {
      type: 'element',
      tagName: 'span',
      properties: { className: ['link-card-title'] },
      children: [{ type: 'text', value: target.title }],
    },
  ];
  if (target.description) {
    parts.push({
      type: 'element',
      tagName: 'span',
      properties: { className: ['link-card-description'] },
      children: [{ type: 'text', value: target.description }],
    });
  }
  if (target.date) {
    // `date` arrives already formatted for display — the resolver runs it through
    // formatPostDate (lib/format.ts), which is where this site's UTC-store / JST-display rule
    // lives. This stage does no timezone work and writes whatever string it is handed.
    parts.push({
      type: 'element',
      tagName: 'span',
      properties: { className: ['link-card-meta'] },
      children: [{ type: 'text', value: target.date }],
    });
  }
  return {
    type: 'element',
    tagName: 'a',
    properties: { className: ['link-card'], href },
    children: parts,
  };
}

// The fallback for a reference whose shape is fine but which resolves to nothing — an unknown
// slug, or a draft, which `getPostBySlug` reports identically by returning null (§6.1). A plain
// link, because the href is a validated same-origin relative path: nothing is lost for the reader,
// and the author sees a link where they expected a card. Dropping the node instead would make the
// body silently shorter, which is the one outcome nobody can debug.
// A bare `<a>`, with no wrapper: this stage does not know what the card's parent is, and a `<p>`
// is not legal everywhere a `<div>` was — a card written inline in a paragraph leaves the
// surrounding text flowing as bare inline content, and a paragraph dropped into the middle of that
// nests wrongly. An anchor is flow content and fits wherever the div fitted, which is the same
// reason the resolved card above is an unwrapped `<a>` too. Both branches then replace the node
// with one element of the same kind.
function fallbackLink(href: string): Element {
  return {
    type: 'element',
    tagName: 'a',
    properties: { href },
    children: [{ type: 'text', value: href }],
  };
}

// Resolves `<div class="link-card" data-href="…">` into a card, a plain link, or nothing
// (docs/link-card-requirements.md §6.1). Must run AFTER rehype-sanitize — see lib/render.ts for
// the ordering and CARD_HREF above for what that costs.
//
// Two passes rather than one: `visit` is synchronous and resolution is not, so the nodes are
// collected first and awaited after. Collecting the parent and index alongside each node is what
// lets a card be replaced by a different element (or removed outright); mutating during the walk
// would renumber the very indices still to be visited.
export function rehypeLinkCard() {
  return async (tree: Root, file: VFile) => {
    const found: { node: Element; parent: Root | Element; index: number }[] = [];
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'div' || !hasClass(node, 'link-card')) return;
      if (!parent || typeof index !== 'number') return;
      found.push({ node, parent, index });
    });
    if (found.length === 0) return;

    const resolve = file.data.resolveCard;
    const replacements = await Promise.all(
      found.map(async ({ node }): Promise<ElementContent | null> => {
        const href = node.properties.dataHref;
        if (typeof href !== 'string' || !CARD_HREF.test(href)) return null;
        // No resolver supplied — the caller renders without a DB (lib/render.test.ts, and any
        // future preview). The reference is still valid, so it degrades to the same plain link an
        // unresolvable one gets rather than vanishing.
        const target = resolve ? await resolve(href) : null;
        return target ? cardElement(href, target) : fallbackLink(href);
      }),
    );

    // Right to left within each parent, so an earlier splice cannot shift the index of one not yet
    // applied. `found` comes out of `visit` in document order, which is per-parent ascending, so
    // reversing the whole list is enough.
    for (let i = found.length - 1; i >= 0; i -= 1) {
      const { parent, index } = found[i];
      const replacement = replacements[i];
      if (replacement) parent.children[index] = replacement;
      else parent.children.splice(index, 1);
    }
  };
}
