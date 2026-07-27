import type { CommandProps } from '@tiptap/core';

// TipTap's toggleX commands (bold/italic/strike/code/accentEmphasis) all delegate to the generic
// `commands.toggleMark(name)`, which unconditionally dispatches a transaction — even when the
// mark can't actually attach because it's excluded by another mark already on the selection (see
// accent-emphasis-extension.ts's `excludes`). The resulting transaction ends up a no-op (the doc
// comes out byte-identical), but it still lands on the undo stack: toggling an excluded mark
// silently costs the user one extra Ctrl+Z press later, with no visible sign anything happened.
// `editor.can().toggleMark(name)` reports this case correctly (confirmed empirically), so gating
// on it stops the dispatch before it's ever created.
export function guardedToggle(name: string) {
  return () =>
    ({ editor, commands }: CommandProps) => {
      if (!editor.can().toggleMark(name)) return false;
      return commands.toggleMark(name);
    };
}
