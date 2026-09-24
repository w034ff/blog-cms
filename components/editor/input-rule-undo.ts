import type { EditorState } from '@tiptap/pm/state';

// Is an input rule still undoable? TipTap marks each input-rule plugin's spec, and the plugin holds
// the last rule's inverse until any transaction changes the document or the selection — the same
// thing `undoInputRule` looks for before it will do anything.
//
// Every one has to be asked, not the first: TipTap builds one such plugin per extension that
// declares input rules, and only the one owning the rule that just fired holds the inverse. Core's
// `undoInputRule` loops for the same reason.
//
// Shared so that details-extension.ts and trailing-node-extension.ts agree on when the window is
// open.
export function hasUndoableInputRule(state: EditorState): boolean {
  return state.plugins.some(
    (candidate) =>
      (candidate.spec as { isInputRules?: boolean }).isInputRules === true &&
      candidate.getState(state) != null,
  );
}
