import type { EditorState } from '@tiptap/pm/state';

// Is an input rule still undoable? TipTap marks each input-rule plugin's spec, and the plugin holds
// the last rule's inverse until any transaction changes the document or the selection — the same
// thing `undoInputRule` looks for before it will do anything.
//
// Every one of them has to be asked, not the first: TipTap builds one such plugin *per extension*
// that declares input rules, so this editor carries 13, and the one holding the inverse is whichever
// extension owns the rule that just fired (measured — checking only the first found nothing, ever).
// Core's `undoInputRule` loops for the same reason.
//
// Shared, because two features hang off the same window: the caret repair after `:::details ` is
// taken back (details-extension.ts) and the trailing paragraph that waits for the window to close
// (trailing-node-extension.ts). They must agree on when it is open, so they ask the same question.
export function hasUndoableInputRule(state: EditorState): boolean {
  return state.plugins.some(
    (candidate) =>
      (candidate.spec as { isInputRules?: boolean }).isInputRules === true &&
      candidate.getState(state) != null,
  );
}
