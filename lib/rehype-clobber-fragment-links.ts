import type { Root, Element } from 'hast';
import { visit } from 'unist-util-visit';

// rehype-sanitize renames every `id` to `<clobberPrefix><id>` (GitHub's DOM-clobbering
// defense — see lib/render.ts) but leaves `href` untouched, so a post's in-page links all
// point at the pre-rename name and jump nowhere: `[見出しへ](#導入)` renders as
// `href="#導入"` against `id="user-content-導入"`. This restores the pairing by applying the
// same rename to fragment links, and so MUST run after sanitize — the prefix it copies is
// the one sanitize actually applied, not the one it was configured with.
//
// The rewrite is unconditional — there is deliberately no "already prefixed, so skip" case,
// because the id side is unconditional too: an author who hand-writes
// `id="user-content-x"` on raw HTML ends up with `user-content-user-content-x`, so a
// `#user-content-x` fragment has to be prefixed like any other. That is also why
// lib/render.ts hands remark-rehype `clobberPrefix: ''`: GFM footnotes are the one
// construct that arrives pre-prefixed on BOTH sides, and leaving that prefix on would let
// sanitize rename only the id half back out of reach.
//
// The prefix is spliced in directly after the `#` so a percent-encoded fragment keeps its
// encoding (remark encodes non-ASCII ids: `#%E5%B0%8E%E5%85%A5` for `導入`). Browsers
// percent-decode a fragment before matching it against an id, so the encoded href and the
// raw id still meet.
export function rehypeClobberFragmentLinks(options: { prefix: string }) {
  const { prefix } = options;
  return (tree: Root) => {
    if (!prefix) return;
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return;
      const href = node.properties.href;
      // A bare `#` is "top of document" and names no id; a fragment-less href addresses
      // another document, whose ids this pipeline never renamed.
      if (typeof href !== 'string' || !href.startsWith('#') || href === '#') return;
      node.properties.href = `#${prefix}${href.slice(1)}`;
    });
  };
}
