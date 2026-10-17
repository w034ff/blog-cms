import type { Root, Element, ElementContent } from 'hast';
import type { VFile } from 'vfile';
import { visit } from 'unist-util-visit';
import { hasClass } from './hast-class';
import { externalCardHost, isCardHref } from './link-card-href';
import { categoryArtHast } from './category-art';
import type { CardImage } from './link-card-image';

// The card's rendered shape, not a `Post`: lib/render.ts must not import the DB
// (docs/link-card-requirements.md §6), so the caller or a test supplies it.
export type CardTarget = { title: string; description: string; image: CardImage | null };
export type ResolveCard = (href: string) => Promise<CardTarget | null>;

declare module 'vfile' {
  interface DataMap {
    resolveCard: ResolveCard;
  }
}

// The resolved card: a text column and the image beside it, all in one `<a>`. Built after sanitize,
// so its classes need no allow-listing.
//
// No date line: the bottom line conventionally carries provenance, which an internal card lacks,
// and a date mostly made older posts look stale. An external card shows the target's host there
// (§14.4), from the href, since only the reference knows where the click goes.
//
// `image` is not re-validated, unlike `data-href`: a photo's `src` comes from `resolveThumbnail` or
// `linkImageSrc` (§14.4), **both same-origin**, so a reader is never pointed at a third party's
// CDN. Any future resolver must keep that. The mark carries no URL at all, only a category.
//
// The text column exists without an image too, keeping the description's width stable.
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
  if (target.image) {
    // `alt=''` on a photo: the title beside it names the card. The mark is `aria-hidden` for the
    // same reason. Which one is drawn comes from the resolver's `kind`, never from testing `src`
    // (docs/category-mark-requirements.md §3.3).
    parts.push(
      target.image.kind === 'mark'
        ? categoryArtHast(['link-card-image'], target.image.category)
        : {
            type: 'element',
            tagName: 'img',
            properties: { className: ['link-card-image'], src: target.image.src, alt: '' },
            children: [],
          },
    );
  }
  return {
    type: 'element',
    tagName: 'a',
    properties: { className: ['link-card'], href },
    children: parts,
  };
}

// For a valid reference that resolves to nothing (unknown slug or draft, §6.1): a plain link, since
// dropping the node would silently shorten the body. A bare `<a>`, as the card is: an anchor fits
// wherever the div did, a `<p>` does not.
function fallbackLink(href: string): Element {
  return {
    type: 'element',
    tagName: 'a',
    properties: { href },
    children: [{ type: 'text', value: href }],
  };
}

// Resolves `<div class="link-card" data-href="…">` into a card, a link, or nothing
// (docs/link-card-requirements.md §6.1). **After sanitize** (lib/render.ts), which costs this:
// `data-href` is allowed as a bare property, so any value rides through, and the `<a href>` built
// here meets no protocol check (§4.4). Hence `isCardHref`, an allowlist of two forms shared with the
// editor (lib/link-card-href.ts). Two passes: resolution is async, and collecting parent and index
// lets a node be replaced or removed.
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
        // No resolver (tests, a preview): degrade to the plain link rather than vanish.
        const target = resolve ? await resolve(href) : null;
        return target ? cardElement(href, target) : fallbackLink(href);
      }),
    );

    // Right to left within each parent, so a splice can't shift a later index.
    for (let i = found.length - 1; i >= 0; i -= 1) {
      const { parent, index } = found[i];
      const replacement = replacements[i];
      if (replacement) parent.children[index] = replacement;
      else parent.children.splice(index, 1);
    }
  };
}
