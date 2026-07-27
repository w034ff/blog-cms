import BaseImage from '@tiptap/extension-image';
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

export const Image = BaseImage.extend({
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
