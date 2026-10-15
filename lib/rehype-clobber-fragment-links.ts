import type { Root, Element } from 'hast';
import type { VFile } from 'vfile';
import { visit } from 'unist-util-visit';

declare module 'vfile' {
  interface DataMap {
    // The page a body's own fragments belong to, for a body drawn away from it: the scribble
    // timeline shows many bodies at once, whose ids repeat across cards (every first footnote is
    // `user-content-fn-1`), so an in-card `#…` would land in whichever card came first. With this
    // set, the link goes to that fragment on the body's own page (docs/scribble-requirements.md §5).
    fragmentBase: string;
  }
}

// rehype-sanitize renames every `id` to `<clobberPrefix><id>` (lib/render.ts) but leaves `href`
// alone, so in-page links pointed at the old names. This applies the same rename to fragment links,
// after sanitize, with the prefix sanitize actually used.
//
// **Unconditional, no "already prefixed" skip**, because the id side is unconditional too: a
// hand-written `id="user-content-x"` becomes `user-content-user-content-x`. That is also why
// lib/render.ts passes remark-rehype `clobberPrefix: ''`. The prefix goes right after `#`, so a
// percent-encoded fragment keeps its encoding; browsers decode before matching.
export function rehypeClobberFragmentLinks(options: { prefix: string }) {
  const { prefix } = options;
  return (tree: Root, file: VFile) => {
    if (!prefix) return;
    const base = file.data.fragmentBase ?? '';
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return;
      const href = node.properties.href;
      // A bare `#` is "top of document" and names no id; a fragment-less href addresses
      // another document, whose ids this pipeline never renamed.
      if (typeof href !== 'string' || !href.startsWith('#') || href === '#') return;
      node.properties.href = `${base}#${prefix}${href.slice(1)}`;
    });
  };
}
