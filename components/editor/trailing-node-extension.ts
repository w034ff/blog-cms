import { Extension } from '@tiptap/core';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { hasUndoableInputRule } from './input-rule-undo';

// Replaces StarterKit's TrailingNode (`StarterKit.configure({ trailingNode: false })`), whose
// behaviour this keeps: whenever the document's last node isn't a paragraph — a callout,
// accordion, table, image, heading, list or code block — an empty paragraph is appended after it,
// so there is always somewhere below the final block to put the caret.
//
// The one addition is the reason this file exists. TipTap's input rules record what a rule
// consumed so that Backspace can put it back (undoInputRule), and *any* later transaction that
// changes the document or moves the selection drops that record (@tiptap/core's inputRulesPlugin:
// `tr.selectionSet || tr.docChanged ? null : prev`). The append above is exactly such a
// transaction, and at the end of the document — where a block shortcut always leaves a
// non-paragraph last — it landed in the same round the rule fired. So the record was already gone
// when the author's Backspace arrived: instead of restoring the literal `:::info `, `:::details `,
// `> `, `## `, `- ` or ``` they had typed, it fell through to the next handler and dissolved the
// freshly created block. The code block carries its own workaround for its fence (fenceUndoKey in
// code-block-extension.ts, which predates this and is left alone); every other shortcut had none.
//
// So the append waits while that record is alive, which is a short wait: the record dies on the
// next transaction that changes the document or moves the selection — a keystroke, a click, an
// arrow key — and appendTransaction runs for that same transaction, so the paragraph lands then.
// The two cases it must *survive* rather than merely defer:
//
//  - The accordion. openInsertedDetails (details-extension.ts) clicks the toggle a frame after the
//    `:::details ` rule, and @tiptap/extension-details answers a `persist: false` toggle with
//    `editor.commands.focus(…)`. The editor already has focus, so that command sets no selection
//    and changes nothing — but TipTap dispatches its (empty) transaction regardless. Waiting only
//    for the rule's own round would let that transaction wake the append one frame later and kill
//    the record, leaving the accordion — the block most likely to be created this way — broken
//    while every other shortcut was fixed.
//  - Backspace arriving first. undoInputRule's transaction puts back the paragraph the rule ate,
//    so the last node is a paragraph again and there is nothing to append: the undo leaves no
//    stray empty line behind, which is the whole point of restoring the text rather than the
//    shortcut having to be re-typed.
//
// Ctrl+Z is held back for a related reason, and this one is not about input rules at all. An
// append riding an undo can't be undone by the next Ctrl+Z: history remaps the older event's
// inverted steps around it, so the paragraph stays while the block it followed goes, and the
// author is left tidying up an empty line they never made. Upstream never hit this because its
// append rode the *creating* transaction and was undone with it. Waiting is the same deal as
// above — the next ordinary transaction brings the paragraph back if the document still needs it.
//
// Dropped along the way: upstream's plugin state field, a cache of "is the last node a paragraph?"
// recomputed only on docChanged. `doc.lastChild` is a direct index into the top node's content, so
// asking each time costs nothing and can't hold a stale answer.
const trailingNodeKey = new PluginKey('trailingNode');

export const TrailingNode = Extension.create({
  name: 'trailingNode',

  addProseMirrorPlugins() {
    // The type the document's content expression opens with (`paragraph`), resolved the way
    // upstream does rather than named outright, so a schema change can't strand this.
    const defaultType = this.editor.schema.topNodeType.contentMatch.defaultType;

    return [
      new Plugin({
        key: trailingNodeKey,
        appendTransaction: (transactions, _oldState, state) => {
          if (!defaultType) return null;
          if (state.doc.lastChild?.type === defaultType) return null;
          if (hasUndoableInputRule(state)) return null;
          if (transactions.some(isHistoryTransaction)) return null;
          return state.tr.insert(state.doc.content.size, defaultType.create());
        },
      }),
    ];
  },
});
