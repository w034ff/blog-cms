import BaseImage from '@tiptap/extension-image';
import { mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { MarkdownSerializerState } from './markdown-serializer-state';

// tiptap-markdown registers prosemirror-markdown's *inline* image serializer for the `image`
// node (see its dist: `serialize: defaultMarkdownSerializer.nodes.image`). That one writes
// `![alt](src)` and stops — correct for an image sitting inside a paragraph, wrong here, because
// @tiptap/extension-image's node is a block (`inline: false`). With no block close, whatever
// follows the image is emitted onto the same line, so `![alt](src)> quoted` reaches the public
// pipeline as one paragraph: the image renders, the `>` and its first line show up as literal
// body text, and the blockquote loses that line. Anything block-level after an image was
// affected — quotes, fences, the lot.
//
// Same output as upstream's, plus the closeBlock the block node needs. The escaping mirrors
// prosemirror-markdown's own: alt through `esc`, parentheses in the URL backslashed (they would
// otherwise close the link early), quotes in the title backslashed.
function serializeImage(state: MarkdownSerializerState, node: PMNode): void {
  const { src, alt, title } = node.attrs;
  const url = typeof src === 'string' ? src.replace(/[()]/g, '\\$&') : '';
  const altText = typeof alt === 'string' ? state.esc(alt) : '';
  const titleText =
    typeof title === 'string' && title !== '' ? ` "${title.replace(/"/g, '\\"')}"` : '';
  state.write(`![${altText}](${url}${titleText})`);
  state.closeBlock(node);
}

// Two boxes around the picture, EDITOR-ONLY: the public page renders from markdown through
// remark/rehype and never runs this, so the stored form is untouched — still `![alt](src)`,
// still a bare <img> on the page.
//
// Why two. An `<img>` is a replaced element and takes no ::before/::after (globals.css says
// this about the link card's picture too), so the thumbnail badge and its outline have to be
// drawn by a box that hugs the PICTURE — `.image-box`. The outer `.image-block` is the block
// itself, column-wide, and what it buys is the drag handle's REVEAL AREA: the handle shows
// through `:has(+ :hover)` on the element right after it, so that element's box is what the
// pointer has to be inside. A centred 390px picture leaves ~188px of empty column on each
// side; with the block that space still belongs to the image, with a shrink-wrapped box alone
// it would not (e2e/image-layout.spec.ts).
//
// It is NOT for the handle's x. `.block-drag-handle` is `position: absolute; left: -0.2rem`,
// a fixed offset, and `alignHandles` sets only its `top` — the handle never tracked the
// picture's width. A first measurement said otherwise and was an artifact:
// `document.querySelector` returns the FIRST handle and there is one per block, so reading it
// for two different blocks read the same element twice.
//
// **Both rings must be re-scoped, not just restyled.** `Decoration.node` (the thumbnail
// highlight) and prosemirror-view's `.ProseMirror-selectednode` both land on the node's OUTER
// dom, which is now `.image-block` — a full-column box. Left alone they would ring the column
// instead of the picture, so globals.css draws them through `.image-box` instead.
export const Image = BaseImage.extend({
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      { class: 'image-block' },
      [
        'div',
        { class: 'image-box' },
        ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)],
      ],
    ];
  },

  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize: serializeImage,
        // Parsing is markdown-it's job, same as upstream — `![alt](src)` comes back through the
        // HTML path and ProseMirror lifts the <img> out of its paragraph into the block node.
        parse: {},
      },
    };
  },
});
