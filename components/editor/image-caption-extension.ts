import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// The editor half of the image caption (lib/rehype-image-caption.ts is the published half): marks
// the paragraph the public pipeline will turn into a `<figcaption>`
// (docs/link-card-requirements.md §22.1).
//
// **The two halves must agree.** The published rule is "a `<p>` whose only child is an `<em>`,
// right after a `<p>` whose only child is an `<img>`"; here that is "every child carries italic",
// which is what serializes to one emphasis over the whole line (`*a* *b*` leaves the space
// unmarked and is two `<em>`s). e2e/image-caption.spec.ts measures the pair.
export function isCaptionParagraph(node: PMNode): boolean {
  if (node.type.name !== 'paragraph' || node.childCount === 0) return false;
  let allItalic = true;
  node.forEach((child) => {
    if (!child.isText || !child.marks.some((mark) => mark.type.name === 'italic'))
      allItalic = false;
  });
  return allItalic;
}

// The caption that is about to be written: the paragraph is still empty, but the caret is in it
// with italic pending, which is the state the bubble menu's 「キャプション」 leaves behind (and the
// state Ctrl+I on an empty line produces by hand).
//
// Without this the text jumps to the centre on the first keystroke, since an empty paragraph is
// not a caption by the rule above. Requiring pending italic keeps it from claiming a plain empty
// line the caret merely landed on.
function isPendingCaption(state: EditorState, node: PMNode, pos: number): boolean {
  if (node.type.name !== 'paragraph' || node.childCount > 0) return false;
  const { selection } = state;
  if (!selection.empty || selection.$from.parent !== node || selection.from !== pos + 1)
    return false;
  const italic = state.schema.marks.italic;
  return italic
    ? italic.isInSet(state.storedMarks ?? selection.$from.marks()) !== undefined
    : false;
}

export const ImageCaption = Extension.create({
  name: 'imageCaption',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('imageCaption'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            // A caption is defined by its preceding sibling. Containers are descended into
            // because an image can sit in a quote or callout and the published rule walks the
            // whole tree.
            state.doc.descendants((node, pos, parent, index) => {
              if (node.type.name !== 'paragraph') return true;
              if (
                parent &&
                index > 0 &&
                parent.child(index - 1).type.name === 'image' &&
                (isCaptionParagraph(node) || isPendingCaption(state, node, pos))
              ) {
                // Only the caption is decorated; globals.css closes the image's margin from the
                // caption's side, so the image atom is never redrawn.
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: 'image-caption',
                    // For the placeholder (globals.css): an empty textblock still holds a trailing
                    // `<br>`, so `:empty` never matches.
                    ...(node.content.size === 0 ? { 'data-empty': '' } : {}),
                  }),
                );
              }
              // A paragraph holds no paragraphs.
              return false;
            });
            return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : null;
          },
        },
      }),
    ];
  },
});
