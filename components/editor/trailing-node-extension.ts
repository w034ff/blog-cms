import { Extension } from '@tiptap/core';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { hasUndoableInputRule } from './input-rule-undo';

// Replaces StarterKit's TrailingNode (`trailingNode: false`): whenever the document's last node
// isn't a paragraph, an empty one is appended so there is always somewhere below the final block
// to put the caret.
//
// The difference from upstream: the append waits while an input rule is still undoable. Any
// transaction that changes the document drops TipTap's undo record for the rule
// (docs/editor-pitfalls.md §2.1), so an append in the same round as a block shortcut at the end
// of the document made Backspace dissolve the new block instead of restoring the typed `:::info `,
// `> `, `## ` etc. The next transaction that changes the document or selection brings the
// paragraph. The wait has to survive two cases rather than merely defer:
//
//  - The accordion: `openInsertedDetails` (details-extension.ts) clicks the toggle a frame after
//    the rule, and @tiptap/extension-details answers with a no-op `editor.commands.focus(…)` whose
//    empty transaction is still dispatched. Waiting only for the rule's own round would let that
//    one wake the append and kill the record.
//  - Backspace arriving first: `undoInputRule` puts the paragraph back, so there is nothing to
//    append and no stray empty line.
//
// History transactions are skipped too: an append riding an undo survives the next Ctrl+Z (history
// remaps the older steps around it), leaving an empty line the author never made.
//
// Upstream's plugin-state cache of "is the last node a paragraph?" is dropped: `doc.lastChild` is a
// direct index, so asking each time is free and never stale.
const trailingNodeKey = new PluginKey('trailingNode');

export const TrailingNode = Extension.create({
  name: 'trailingNode',

  addProseMirrorPlugins() {
    // Resolved the way upstream does rather than named, so a schema change can't strand this.
    const defaultType = this.editor.schema.topNodeType.contentMatch.defaultType;

    // The footnote section is pinned last by the doc's content expression
    // (docs/footnote-requirements.md §3.1), so both the check and the insertion skip past it: a
    // paragraph below the definitions would render above them on the page, and doing nothing
    // would leave a table or fence against the section with no caret position below it.
    const sectionType = this.editor.schema.nodes.footnoteSection;

    return [
      new Plugin({
        key: trailingNodeKey,
        appendTransaction: (transactions, _oldState, state) => {
          if (!defaultType) return null;

          const last = state.doc.lastChild;
          const trailingSection = sectionType && last?.type === sectionType ? last : null;
          const index = state.doc.childCount - (trailingSection ? 2 : 1);
          if (index >= 0 && state.doc.child(index).type === defaultType) return null;

          if (hasUndoableInputRule(state)) return null;
          if (transactions.some(isHistoryTransaction)) return null;

          const end = state.doc.content.size;
          const position = trailingSection ? end - trailingSection.nodeSize : end;
          // Marked so the append can be told apart from an edit. See isTrailingNodeOnlyUpdate.
          return state.tr.insert(position, defaultType.create()).setMeta(trailingNodeKey, true);
        },
      }),
    ];
  },
});

// Whether a round of transactions changed the document only because this extension appended its
// paragraph — that is, the author did nothing.
//
// The append rides someone else's transaction, and @tiptap/core emits `update` for the whole round
// (`!transactions.some(tr => tr.docChanged)` is its only bail-out). Without this, merely clicking
// into a published post ending in a list, heading, table or fence ran an autosave that wrote an
// identical `draft_content` row, so the post showed unpublished changes it did not have.
// `appendedTransactions` comes from the same emit, which is what makes the two separable.
export function isTrailingNodeOnlyUpdate(
  transaction: Transaction,
  appendedTransactions: readonly Transaction[],
): boolean {
  if (transaction.docChanged) return false;
  const changed = appendedTransactions.filter((tr) => tr.docChanged);
  return changed.length > 0 && changed.every((tr) => tr.getMeta(trailingNodeKey) === true);
}
