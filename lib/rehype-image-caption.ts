import type { Root, Element } from 'hast';
import { visit, SKIP } from 'unist-util-visit';

// A caption under a body image: the paragraph right after an image, when that paragraph is
// nothing but one emphasis. `![alt](src)` then a blank line then `*キャプション*` becomes
// `<figure><img><figcaption>キャプション</figcaption></figure>`.
//
// **The shape is this editor's, not Zenn's.** Zenn's convention puts the caption on the line
// IMMEDIATELY after the image, so the two share one paragraph, and its stylesheet reaches the
// caption with `.znc img.md-img~em` (measured 2026-09-08, docs/cms-features.md「画像キャプション」).
// That is not reproducible here and does not need to be: the editor's image is a block node whose
// serializer closes the block (`serializeImage`, components/editor/image-extension.ts), so what an
// author can actually write is the two-paragraph form — measured through the real editor, saved
// and reloaded, in `e2e/image-caption.spec.ts`.
//
// The two-paragraph form is also the safer one. A general-sibling rule can only ask "an emphasis
// somewhere after the image", so on Zenn a `*強調*` written into ordinary prose on the line under
// a picture is drawn as a caption; 6 of 71 sampled images sit one `*` away from that. The
// condition that removes the ambiguity is "the emphasis is the paragraph's ONLY child", which CSS
// cannot express and this stage can — which is why the caption is built here rather than styled
// where it stands.
//
// Runs after sanitize, like rehype-pretty-code and rehypeLinkCard: `figure` and `figcaption` are
// not in `defaultSchema` (measured — `tagNames` holds neither), so an element built before
// sanitize would be stripped, and one built after needs no allow-listing.

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

      // The `<em>` is unwrapped rather than kept. It is the notation for "this line is the
      // caption", not a request for italics — and the look this repo settled on (note's, measured
      // 2026-09-08) is upright. Keeping it would also put `.prose em`'s skew transform on the
      // caption, which is the editor-side thing globals.css has to undo.
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
