import type { CommandProps } from '@tiptap/core';

// TipTap's toggleX commands delegate to `commands.toggleMark(name)`, which dispatches even when the
// mark is excluded by one already on the selection (accent-emphasis-extension.ts's `excludes`).
// The no-op transaction still lands on the undo stack and costs a silent extra Ctrl+Z.
// `editor.can().toggleMark(name)` reports that case correctly, so gating on it stops the dispatch.
export function guardedToggle(name: string) {
  return () =>
    ({ editor, commands }: CommandProps) => {
      if (!editor.can().toggleMark(name)) return false;
      return commands.toggleMark(name);
    };
}
