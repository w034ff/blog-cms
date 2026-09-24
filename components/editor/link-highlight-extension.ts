import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Tints the text the link card is about (docs/link-requirements.md §5.5.7). A decoration, since
// ProseMirror's MutationObserver owns the rendered `<a>`. The range is pushed in from LinkBubble,
// because what is lit depends on UI state (card hidden by Escape, URL field open over a selection)
// that is not in the document.

export type LinkHighlightRange = { from: number; to: number } | null;

export const linkHighlightKey = new PluginKey<LinkHighlightRange>('linkHighlight');

// Push a range, or null to clear. A no-op when unchanged: it is called from a render effect, and
// an unconditional dispatch loops ("Maximum update depth").
export function setLinkHighlight(editor: Editor, range: LinkHighlightRange): void {
  const current = linkHighlightKey.getState(editor.state) ?? null;
  if (current?.from === range?.from && current?.to === range?.to) return;
  editor.view.dispatch(editor.state.tr.setMeta(linkHighlightKey, range));
}

export const LinkHighlight = Extension.create({
  name: 'linkHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<LinkHighlightRange>({
        key: linkHighlightKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(linkHighlightKey) as LinkHighlightRange | undefined;
            if (meta !== undefined) return meta;
            if (!value) return null;
            // Mapped inward, so text inserted at an edge stays outside the tint and a deleted
            // range collapses and is dropped.
            const from = tr.mapping.map(value.from, 1);
            const to = tr.mapping.map(value.to, -1);
            return from < to ? { from, to } : null;
          },
        },
        props: {
          decorations(state) {
            const range = linkHighlightKey.getState(state);
            if (!range) return null;
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, { class: 'link-bubble-target' }),
            ]);
          },
        },
      }),
    ];
  },
});
