import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// The editor half of the image caption (lib/rehype-image-caption.ts is the published half): marks
// the paragraph that the public pipeline will turn into a `<figcaption>`, so the author sees the
// caption as a caption while writing it rather than as an italic paragraph that changes shape once
// published. §22.1 of docs/link-card-requirements.md commits the editor to showing an image the way
// the published page does, and a caption is part of that picture.
//
// **The two halves must agree on what a caption is, and they are written against different
// material** — hast there, a ProseMirror document here. The published rule is "a `<p>` whose only
// child is an `<em>`, right after a `<p>` whose only child is an `<img>`". Its equivalent here is
// "every child of the paragraph carries the italic mark", because that is what serializes to an
// emphasis spanning the whole line: `*a* *b*` leaves the space between them unmarked (two `<em>`s
// on the page, so no caption on either side), while `*a **b*** ` keeps italic on both children (one
// `<em>` containing a `<strong>`, so a caption on both sides). e2e/image-caption.spec.ts measures
// the pair rather than trusting the correspondence.
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
// **Without this the caret starts at the left margin and the text jumps to the centre on the first
// keystroke**, because an empty paragraph is not a caption by the rule above — correctly so: it
// serializes to nothing, and the published side has nothing to build a `<figcaption>` from. So the
// pending state is the editor's alone, and it is written narrowly enough that it cannot claim a
// paragraph the author is using for something else: the italic has to already be pending, which is
// never true of a plain empty line the caret merely landed on.
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
            // `descendants` hands over the parent and the index within it, which is the whole
            // question — a caption is defined by what precedes it, not by anything it holds.
            //
            // Every other node type is descended into rather than skipped: a blockquote and a
            // callout are both `block+`, so an image and its caption can sit inside one
            // (useImageUpload refuses only table cells and code blocks), and the published rule
            // walks the whole tree. Returning false here for containers would mark the caption on
            // one surface and not the other.
            state.doc.descendants((node, pos, parent, index) => {
              if (node.type.name !== 'paragraph') return true;
              if (
                parent &&
                index > 0 &&
                parent.child(index - 1).type.name === 'image' &&
                (isCaptionParagraph(node) || isPendingCaption(state, node, pos))
              ) {
                // **Only the caption is decorated.** The picture needs its bottom margin closed so
                // the caption sits where the published `<figcaption>` does, and globals.css does
                // that from the caption's side with a negative margin rather than by marking the
                // image here — one rule instead of a second decoration, and nothing that redraws
                // an atom's DOM when a sibling's text changes.
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: 'image-caption',
                    // What the placeholder copy hangs off (globals.css). **The emptiness has to
                    // arrive as an attribute** — an empty ProseMirror textblock still holds a
                    // trailing `<br>`, so `:empty` never matches it; footnote-extension.ts's
                    // `data-empty` is here for the same reason. Only the pending case can be
                    // empty: a caption proper is non-empty by definition.
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
