import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { deleteClampedSelection } from './isolating-boundary';
import { speakerdeckSnippetHref } from '@/lib/speakerdeck-snippet';

// Pasting Speaker Deck's embed snippet makes the embed (docs/embed-requirements.md §16.9).
//
// **The one place a paste creates a block, although §5 says paste is not a trigger.** That rule
// keeps a bare URL pasteable as a link; a snippet is not a bare URL and otherwise lands as literal
// markup. The exception is narrow: the paste must *begin* with `<iframe` or `<script` and carry a
// reference `resolveEmbed` accepts (lib/speakerdeck-snippet.ts).
//
// Any node whose spec declares `code` is left alone — that is where someone writes *about* a
// snippet. Only `text/plain` is read, which is what Speaker Deck's copy buttons write
// (`data-clipboard-text`).
const speakerdeckSnippetPasteKey = new PluginKey('speakerdeckSnippetPaste');

export const SpeakerdeckSnippetPaste = Extension.create({
  name: 'speakerdeckSnippetPaste',
  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin({
        key: speakerdeckSnippetPasteKey,
        props: {
          handlePaste(view, event) {
            if (view.state.selection.$from.parent.type.spec.code) return false;
            const text = event.clipboardData?.getData('text/plain') ?? '';
            if (text === '') return false;
            const href = speakerdeckSnippetHref(text);
            if (href === null) return false;
            // **The selection is replaced first, because that is what a paste is.** `setEmbed`
            // works only at a caret (`canPlaceAfterCaret`), the right rule for the slash menu and
            // the bubble but not for a paste over a range.
            const chain = editor.chain();
            if (!view.state.selection.empty) {
              chain
                // **Clamped, because a range can reach into an isolating box** — e.g. the last line
                // above the footnotes, whose selection ends inside the first definition. A plain
                // `deleteSelection` joined across that edge and left the caret where no embed may
                // go. `deleteClampedSelection` leaves the caret where the selection started, and
                // answers false when no edge is crossed.
                .command(
                  (props) => deleteClampedSelection(props) || props.commands.deleteSelection(),
                )
                // **A deletion does not always leave a caret.** An `AllSelection` maps through its
                // own deletion as a non-empty AllSelection, which `setEmbed` refuses; a separate
                // step so the next command reads the selection from fresh props.
                .command(({ tr, commands }) => {
                  if (tr.selection.empty) return true;
                  return commands.setTextSelection(tr.selection.from);
                });
            }
            return (
              chain
                .command(({ tr, commands }) => {
                  // **Placement is asked of `setEmbed`, never restated here**, after the deletion so
                  // it reads the caret the deletion left (§16.9).
                  if (commands.setEmbed(href)) return true;
                  // **The deletion must not survive on its own.** `createChain` (@tiptap/core)
                  // dispatches even when a later command returns false unless `preventDispatch` is
                  // set; without this, a paste in a table cell would eat the selection and place
                  // nothing.
                  tr.setMeta('preventDispatch', true);
                  return false;
                })
                // As every other handlePaste here: prosemirror-history reads it to keep a paste out
                // of the preceding typing's undo event.
                .setMeta('uiEvent', 'paste')
                .run()
            );
          },
        },
      }),
    ];
  },
});
