import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Tints the text the link card is currently about (docs/link-requirements.md §5.5.7). Docs does the
// same thing, and it answers a real ambiguity: the card is anchored under the `<a>`, but with two
// links on one line — or with the URL field open and no link made yet — nothing on the page says
// which text the card's buttons are aimed at.
//
// A decoration, not a class on the rendered `<a>`. ProseMirror's own MutationObserver watches the
// content it manages, so setting an attribute on a node it rendered is a change it has to decide
// what to do about; decorations are the supported way to paint over content without telling the
// document about it.
//
// The range is pushed in from LinkBubble rather than derived here, because what should be lit is
// not a property of the document: it depends on whether the card is showing at all (Escape hides it
// while the caret stays in the link) and on whether the URL field is open over a selection that is
// not yet a link. LinkBubble already holds both, so this plugin stays a dumb store.

export type LinkHighlightRange = { from: number; to: number } | null;

export const linkHighlightKey = new PluginKey<LinkHighlightRange>('linkHighlight');

// Push a range, or null to clear. A no-op when it would not change anything: this is called from a
// render effect, and dispatching unconditionally would put a transaction into every render — which
// re-renders us, which is the "Maximum update depth" loop the table toolbar documents.
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
            // Autosave does not change the document, but an undo landing while the card is up
            // does. Mapping inward (bias 1 at the start, -1 at the end) means text inserted at
            // either edge stays outside the tint rather than joining it, and a range that is
            // deleted outright collapses and is dropped.
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
