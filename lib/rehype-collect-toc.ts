import type { Root, Element } from 'hast';
import type { VFile } from 'vfile';
import { visit } from 'unist-util-visit';
import { toString } from 'hast-util-to-string';

export type TocEntry = { id: string; text: string; level: 2 | 3 };

declare module 'vfile' {
  interface DataMap {
    toc: TocEntry[];
  }
}

// Must run after rehype-sanitize (reads the final, clobber-prefixed `id` — see lib/render.ts).
// The editor caps body headings at h2/h3 (components/PostEditor.tsx:
// Heading.configure({ levels: [2, 3] })), so those are the only two levels a post can ever
// produce — nothing to filter out here.
export function rehypeCollectToc() {
  return (tree: Root, file: VFile) => {
    // Headings inside an accordion are left out (docs/accordion-requirements.md §8.1): a table of
    // contents lists what the reader can see, and the author folded these away deliberately. It
    // also keeps the default navigation off a path whose behaviour is the browser's to decide —
    // whether following a fragment into a closed <details> opens it varies, and Chrome's automatic
    // expansion is not something to build the only route to a heading on.
    //
    // Collected as a set of nodes first rather than asked per heading: `visit` hands over a parent
    // but not a full ancestry, so a nested heading could not answer the question on its own, and
    // an ancestry walk would mean pulling in unist-util-visit-parents for one predicate.
    //
    // The ids themselves are untouched — rehype-slug still assigns one to every heading, so an
    // in-page `[…](#見出し)` or an external `#user-content-…` still resolves here.
    const inDetails = new Set<Element>();
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'details') return;
      visit(node, 'element', (inner: Element) => {
        if (inner.tagName === 'h2' || inner.tagName === 'h3') inDetails.add(inner);
      });
    });

    const toc: TocEntry[] = [];
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'h2' && node.tagName !== 'h3') return;
      if (inDetails.has(node)) return;
      const id = node.properties.id;
      if (typeof id !== 'string') return;
      toc.push({ id, text: toString(node), level: node.tagName === 'h2' ? 2 : 3 });
    });
    file.data.toc = toc;
  };
}
