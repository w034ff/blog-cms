import type { Root, Element, ElementContent } from 'hast';
import type { VFile } from 'vfile';
import { visit } from 'unist-util-visit';
import { externalCardHost, isCardHref } from './link-card-href';

// What a card resolves to. Deliberately the shape the card renders, not a `Post`: lib/render.ts
// must not import the DB or its types (docs/link-card-requirements.md §6), so the caller —
// app/posts/[slug]/page.tsx — is what knows about `posts`, and a test can hand over a literal.
export type CardTarget = { title: string; description: string; thumbnail: string | null };
export type ResolveCard = (href: string) => Promise<CardTarget | null>;

declare module 'vfile' {
  interface DataMap {
    resolveCard: ResolveCard;
  }
}

function hasClass(node: Element, name: string): boolean {
  const className = node.properties.className;
  return Array.isArray(className) && className.includes(name);
}

// The resolved card: a text column (title, and a description when there is one) and, beside it, the
// target's image when it has one. Every class here is invented by this stage, which runs after
// sanitize, so none of it needs allow-listing — the same position (and the same reason)
// rehype-pretty-code's own spans rely on. `<a>` wraps the whole card so the entire block is one
// click target.
//
// A third line carrying the target's date was dropped 2026-08-15. The bottom line of a link card
// conventionally carries provenance — which site, which author — and that is what earns it the
// click. A card pointing at this blog has nothing to put there, and a date shown in its place
// mostly makes an older post look stale; the image took the space instead (2026-08-15). On an
// external card the slot means something and holds the target's host (§14.4), which is why the
// line below is built from the href rather than from the resolver's answer — it says where the
// click goes, and only the reference knows that.
//
// `thumbnail` is NOT re-validated here, unlike `data-href` below, and the difference is where each
// one comes from. The href is written into the body by an author and reaches this stage having
// skipped sanitize's protocol check; the thumbnail comes from the injected resolver, which builds
// it either with `resolveThumbnail` (lib/thumbnail.ts — a `/uploads/…` path, for a post) or with
// `linkImageSrc` (lib/link-image.ts — a signed `/api/link-image?…` path, for an external card's
// picture, §14.4). **Both are same-origin**, which is the property that matters: an external card
// never points a reader at the target's CDN. Re-checking the shape here would be checking this
// project against itself; what matters is that no future resolver hands over a value it did not
// build with one of those two.
//
// The text column exists even when there is no image: it is what keeps the description clamped to
// the column's width rather than the card's, so a card gains and loses its picture without the
// text re-flowing into a different shape.
function cardElement(href: string, target: CardTarget): Element {
  const lines: Element[] = [
    {
      type: 'element',
      tagName: 'span',
      properties: { className: ['link-card-title'] },
      children: [{ type: 'text', value: target.title }],
    },
  ];
  if (target.description) {
    lines.push({
      type: 'element',
      tagName: 'span',
      properties: { className: ['link-card-description'] },
      children: [{ type: 'text', value: target.description }],
    });
  }
  const host = externalCardHost(href);
  if (host) {
    lines.push({
      type: 'element',
      tagName: 'span',
      properties: { className: ['link-card-domain'] },
      children: [{ type: 'text', value: host }],
    });
  }
  const parts: Element[] = [
    {
      type: 'element',
      tagName: 'span',
      properties: { className: ['link-card-text'] },
      children: lines,
    },
  ];
  if (target.thumbnail) {
    // `alt=''` deliberately: the title is right beside it inside the same anchor, so naming the
    // image would make a screen reader read the card twice.
    parts.push({
      type: 'element',
      tagName: 'img',
      properties: { className: ['link-card-image'], src: target.thumbnail, alt: '' },
      children: [],
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
// the ordering, and this is what that position costs:
//
// The stored form carries a reference and nothing else (§4.2), so `data-href` is the whole of what
// an author can write into a card — and it is NOT value-checked on the way in. `className` passes
// rehype-sanitize as a value allowlist, but `data-href` is a bare property name, so once it is
// allowed at all any value rides through; and running after sanitize means the `<a href>` built
// below never meets its protocol check either (§4.4). Hence `isCardHref`, which the editor asks as
// well so that both sides accept the same references, and hence it is an allowlist of two forms
// rather than a blacklist of bad protocols (lib/link-card-href.ts).
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
        if (typeof href !== 'string' || !isCardHref(href)) return null;
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
