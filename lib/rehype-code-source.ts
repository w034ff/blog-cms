import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';
import { blobSourceFromFilename } from './github-blob';
import { GITHUB_MARK_PATH } from './github-mark';

// A code block whose filename is a GitHub blob URL wears a link to that file instead of the URL
// (docs/embed-requirements.md §19.4).
//
// **Nothing here fetches or stores**: the header is derived on every render from the filename the
// fence already carries. After `rehypePrettyCode` (which builds the `<figcaption>`) and before
// `rehypeNewTabLinks` (which gives the anchor its `target`). After sanitize, like its neighbours: its
// only followable URL is one `parseGithubBlob` rebuilt from validated segments.

const TITLE = 'data-rehype-pretty-code-title';

// GitHub's mark, drawn the way the editor's own icons are: a 24-unit box, `currentColor`, and
// `aria-hidden` because the link beside it carries the name.
function mark(): Element {
  return {
    type: 'element',
    tagName: 'svg',
    properties: {
      className: ['code-source-mark'],
      viewBox: '0 0 24 24',
      width: 14,
      height: 14,
      fill: 'currentColor',
      ariaHidden: 'true',
    },
    children: [
      { type: 'element', tagName: 'path', properties: { d: GITHUB_MARK_PATH }, children: [] },
    ],
  };
}

function span(className: string, value: string): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: [className] },
    children: [{ type: 'text', value }],
  };
}

export function rehypeCodeSource() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'figcaption') return;
      if (!(TITLE in (node.properties ?? {}))) return;
      // The caption's text is exactly the fence's filename — pretty-code writes it as one text
      // child — and for every code block that is not an import, it is a name and this does nothing.
      const value = node.children.map((c) => (c.type === 'text' ? c.value : '')).join('');
      const source = blobSourceFromFilename(value);
      if (!source) return;

      node.properties = { ...node.properties, className: ['code-source'] };
      node.children = [
        {
          type: 'element',
          tagName: 'a',
          properties: { href: source.href, className: ['code-source-link'], title: source.href },
          children: [
            mark(),
            span('code-source-repo', source.repo),
            span('code-source-path', source.path),
          ],
        },
      ];
    });
  };
}
