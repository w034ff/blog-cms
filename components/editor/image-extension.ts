import BaseImage from '@tiptap/extension-image';
import { mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { MarkdownSerializerState } from './markdown-serializer-state';

// tiptap-markdown uses prosemirror-markdown's *inline* image serializer
// (`serialize: defaultMarkdownSerializer.nodes.image`), but this node is a block, so without a
// closeBlock the next block landed on the same line (`![alt](src)> quoted`). Same output as
// upstream plus the closeBlock; escaping mirrors prosemirror-markdown's.
function serializeImage(state: MarkdownSerializerState, node: PMNode): void {
  const { src, alt, title } = node.attrs;
  const url = typeof src === 'string' ? src.replace(/[()]/g, '\\$&') : '';
  const altText = typeof alt === 'string' ? state.esc(alt) : '';
  const titleText =
    typeof title === 'string' && title !== '' ? ` "${title.replace(/"/g, '\\"')}"` : '';
  state.write(`![${altText}](${url}${titleText})`);
  state.closeBlock(node);
}

// Two boxes around the picture, editor-only (the stored form is still `![alt](src)`). An `<img>`
// takes no ::before/::after, so the thumbnail badge needs `.image-box`, which hugs the picture.
// The column-wide `.image-block` keeps the empty space beside a centred picture inside the drag
// handle's `:has(+ :hover)` reveal area (e2e/image-layout.spec.ts). The handle's x is a fixed
// offset and does not depend on either box.
//
// **Both rings must be re-scoped:** the thumbnail `Decoration.node` and `.ProseMirror-selectednode`
// land on the outer `.image-block`, so globals.css draws them through `.image-box`.
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
        // Parsed by markdown-it as upstream; ProseMirror lifts the <img> into the block node.
        parse: {},
      },
    };
  },
});
