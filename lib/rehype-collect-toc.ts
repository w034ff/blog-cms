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

// After rehype-sanitize (reads the final clobber-prefixed `id`, see lib/render.ts). Body headings
// are only h2/h3 (`Heading.configure({ levels: [2, 3] })` in components/editor/extensions.ts), so
// there is nothing else to filter.
export function rehypeCollectToc() {
  return (tree: Root, file: VFile) => {
    // Headings inside an accordion are left out (docs/accordion-requirements.md §8.1): the author
    // folded them away, and whether a fragment opens a closed <details> is up to the browser.
    // Collected as a node set first, since `visit` gives only the parent, not the ancestry. Their ids
    // are untouched, so in-page links still resolve.
    //
    // The footnote section is out too (docs/footnote-requirements.md §8): remark-gfm's sr-only
    // `<h2 id="footnote-label">Footnotes</h2>` would add an English entry to a Japanese post.
    const hidden = new Set<Element>();
    visit(tree, 'element', (node: Element) => {
      const isDetails = node.tagName === 'details';
      const isFootnotes = node.tagName === 'section' && 'dataFootnotes' in node.properties;
      if (!isDetails && !isFootnotes) return;
      visit(node, 'element', (inner: Element) => {
        if (inner.tagName === 'h2' || inner.tagName === 'h3') hidden.add(inner);
      });
    });

    const toc: TocEntry[] = [];
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'h2' && node.tagName !== 'h3') return;
      if (hidden.has(node)) return;
      const id = node.properties.id;
      if (typeof id !== 'string') return;
      toc.push({ id, text: toString(node), level: node.tagName === 'h2' ? 2 : 3 });
    });
    file.data.toc = toc;
  };
}
