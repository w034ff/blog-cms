import type { Root, Element } from 'hast';
import { visit, SKIP } from 'unist-util-visit';

// A caption under a body image: the paragraph right after an image, when that paragraph is
// nothing but one emphasis. `![alt](src)` then a blank line then `*キャプション*` becomes
// `<figure><img><figcaption>キャプション</figcaption></figure>`.
//
// **The shape is this editor's, not Zenn's** (docs/cms-features.md「画像キャプション」): Zenn puts the
// caption on the image's own line and styles `.znc img.md-img~em`, but the editor's image block
// closes its paragraph (`serializeImage`), so the two-paragraph form is what can be written. It is
// also safer: requiring the emphasis to be the paragraph's ONLY child keeps ordinary `*強調*` under a
// picture from becoming a caption, which CSS can't express.
//
// After sanitize: `figure`/`figcaption` are not in `defaultSchema.tagNames`.

// The single element a node contains, ignoring the whitespace between tags. Null unless the node
// holds exactly one element and nothing else — the condition the whole convention rests on.
function soleElement(node: Element, tagName: string): Element | null {
  const kids = node.children.filter((c) => c.type !== 'text' || c.value.trim() !== '');
  if (kids.length !== 1) return null;
  const [only] = kids;
  return only.type === 'element' && only.tagName === tagName ? only : null;
}

// The next sibling that is not whitespace. remark leaves a `\n` text node between block elements,
// so the caption paragraph is never at `index + 1`.
function nextElementIndex(children: readonly { type: string; value?: string }[], from: number) {
  let i = from;
  while (i < children.length) {
    const node = children[i];
    if (node.type === 'text' && (node.value ?? '').trim() === '') i++;
    else break;
  }
  return i;
}

export function rehypeImageCaption() {
  return (tree: Root): void => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'p' || index === undefined || !parent) return;
      const image = soleElement(node, 'img');
      if (!image) return;

      const captionIndex = nextElementIndex(parent.children, index + 1);
      const candidate = parent.children[captionIndex];
      if (!candidate || candidate.type !== 'element' || candidate.tagName !== 'p') return;
      const emphasis = soleElement(candidate, 'em');
      if (!emphasis) return;

      // The `<em>` is notation for "caption", not italics; the settled look is upright.
      const figure: Element = {
        type: 'element',
        tagName: 'figure',
        properties: { className: ['image-figure'] },
        children: [
          image,
          {
            type: 'element',
            tagName: 'figcaption',
            properties: {},
            children: emphasis.children,
          },
        ],
      };
      parent.children.splice(index, captionIndex - index + 1, figure);
      // Continue after the figure. Its children need no visit of their own — the one later stage
      // that reads anchors it did not build (rehypeNewTabLinks) is a separate pass.
      return [SKIP, index + 1];
    });
  };
}
