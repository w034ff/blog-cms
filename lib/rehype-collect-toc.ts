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
    const toc: TocEntry[] = [];
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'h2' && node.tagName !== 'h3') return;
      const id = node.properties.id;
      if (typeof id !== 'string') return;
      toc.push({ id, text: toString(node), level: node.tagName === 'h2' ? 2 : 3 });
    });
    file.data.toc = toc;
  };
}
