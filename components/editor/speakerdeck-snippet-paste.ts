import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { deleteClampedSelection } from './isolating-boundary';
import { speakerdeckSnippetHref } from '@/lib/speakerdeck-snippet';

// Pasting Speaker Deck's embed snippet makes the embed (docs/embed-requirements.md §16.9).
//
// **This is the one place a paste creates a block, and §5 says paste is not a trigger.** That rule
// protects a real thing — a bare URL has to stay pasteable as a plain link, and §0's own YouTube
// line is that shape. A snippet is not a bare URL: measured 2026-08-26, pasting one today puts
// `<iframe class="speakerdeck-iframe" …>` into the paragraph as literal text with its `src`
// autolinked, which is nobody's intent. So the exception is narrow by construction — the paste has
// to *begin* with `<iframe` or `<script` and carry a reference `resolveEmbed` accepts
// (lib/speakerdeck-snippet.ts), and everything else falls through untouched.
//
// A code block is left alone, which is where "I am writing about this snippet" actually lives. The
// question is asked of the node the caret is in rather than of the code block type, so any node
// declaring `code` in its spec answers for itself.
//
// The clipboard is read as `text/plain` because that is what Speaker Deck's own buttons write
// (`data-clipboard-text`, measured). A copy of *rendered* markup carries `text/html` instead, and is
// not handled: the schema drops the iframe and nothing lands, which is what happens today.
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
            // works only at a caret (`canPlaceAfterCaret`), which is the right rule for the slash
            // menu and the bubble — with a range, "after the caret's textblock" is not where the
            // author is pointing — but a paste's whole gesture is to put the pasted thing where
            // the selection was. Until this ran (measured 2026-09-03), dragging over the two blank
            // lines the embed was meant to fill and pasting left the snippet there as text, which
            // is §16.9's failure and not its rule.
            const chain = editor.chain();
            if (!view.state.selection.empty) {
              chain
                // **Clamped, because a range can reach into an isolating box.** Dragging the last
                // line above the footnotes ends the selection at the first definition's content
                // start — one line is highlighted, and `deleteSelection` would join the paragraph
                // into the footnote section across an edge nothing may join across
                // (isolating-boundary.ts). It left the caret inside the definition, where no embed
                // may go, so the paste fell through and landed as text (reported and measured
                // 2026-09-03). `deleteClampedSelection` deletes the pieces on each side of the edge
                // and leaves the caret where the selection started, which is the paragraph the
                // author was pointing at; it answers false when no edge is crossed, and the
                // ordinary deletion runs then.
                .command(
                  (props) => deleteClampedSelection(props) || props.commands.deleteSelection(),
                )
                // **A deletion does not always leave a caret.** Ctrl+A gives an `AllSelection`,
                // which maps through its own deletion as an AllSelection over the emptied
                // document — not `empty`, so `setEmbed` refuses it exactly as it refused the range
                // before anything was deleted (measured 2026-09-03, and the reason this is a step
                // of its own: the next command reads the selection out of props built after it).
                // `setTextSelection` clamps into the textblock the deletion left.
                .command(({ tr, commands }) => {
                  if (tr.selection.empty) return true;
                  return commands.setTextSelection(tr.selection.from);
                });
            }
            return (
              chain
                .command(({ tr, commands }) => {
                  // **Placement is asked of `setEmbed`, never restated here**, and asked after the
                  // deletion so the caret it reads is the one the deletion left — a range spanning
                  // two blank lines becomes one empty paragraph, which is the shape §16.9's
                  // "no empty paragraph is left behind" depends on.
                  if (commands.setEmbed(href)) return true;
                  // **The deletion must not survive on its own.** A chain dispatches whatever the
                  // transaction holds even when a later command returns false (`createChain` in
                  // @tiptap/core, which dispatches unless `preventDispatch` is set), so without
                  // this a snippet pasted over a selection in a table cell would eat the selection
                  // and place nothing. With it the transaction is dropped whole and handlePaste
                  // returns false, which is the fall-through every unplaceable paste already got.
                  tr.setMeta('preventDispatch', true);
                  return false;
                })
                // `uiEvent: 'paste'` is what every other handlePaste in this editor sets
                // (link-paste-paragraph-guard.ts, the two slice guards, isolating-boundary.ts) — it
                // is read by prosemirror-history to close the current event, so a paste is not
                // grouped with the typing before it. Measured here as already separate without it
                // (the block insertion is not adjacent to the typing), and set anyway: nothing
                // should depend on the shape of that grouping heuristic.
                .setMeta('uiEvent', 'paste')
                .run()
            );
          },
        },
      }),
    ];
  },
});
