'use client';

import { useState, type ChangeEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { InsertControls } from './Toolbar';
import { ToolbarButton } from './ToolbarButton';
import { useDismiss } from './useDismiss';
import { PlusIcon } from './svg/PlusIcon';

// The phone's home for 囲み枠・表・リンク・画像 (docs/table-requirements.md §12.5). The format
// controls moved to a bar at the bottom of the screen, where the caret and the thumb are; these
// four did not go with them, because they are not wanted mid-keystroke and the bottom bar has no
// width to spare once the software keyboard is up.
//
// Drawn only under `hover: none` — the whole component, trigger and panel together, is hidden by
// one rule in app/globals.css. Written that way rather than as a `matchMedia` read in React for
// the reason §12.1 and §12.4 give: a media query in React renders one way and corrects itself,
// which is a hydration mismatch. The controls themselves are `InsertControls`, the same component
// the toolbar renders for a pointer — two copies in the DOM, one painted.
//
// **The accessible name is not 「挿入」.** `getByRole`'s `name` matches a substring by default, so
// 挿入 would also select 挿入する (InsertDialog) and 2行2列の表を挿入 — and the table buttons are
// inside this very panel, visible at the same moment.
export function InsertMenu({
  editor,
  uploading,
  onImageChange,
}: {
  editor: Editor;
  uploading: boolean;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  return (
    // `insert-menu` is the hook the `hover: hover` rule hides. `relative` anchors the panel, which
    // opens downward: this sits in the page header at the top of the screen, so it has the room
    // the bottom bar's own menu does not (ToolbarDropdown's `up` direction is for that one).
    <div ref={ref} className='insert-menu relative flex'>
      <ToolbarButton
        onClick={() => setOpen((prev) => !prev)}
        active={open}
        title='ブロックを追加'
        tooltipHidden={open}>
        <PlusIcon />
      </ToolbarButton>
      {open && (
        // Anchored to the trigger's right edge rather than centred on it, which is the one
        // placement that cannot run off the right however far along the header the trigger sits —
        // the header wraps, so that position is a function of width. ToolbarDropdown's `shiftX`
        // solves the same problem by measuring; this panel is narrow enough (75px, measured
        // 2026-09-15) that the static anchor is the whole answer, at 320px through 412px.
        //
        // A column, and the controls keep their row shape inside it: these are ToolbarButtons, and
        // their own touch height (40px, `hover: none`) is what makes the rows pressable.
        //
        // **Choosing a row does not close this panel.** 囲み枠 and 表 are themselves dropdown
        // triggers, and a blanket close-on-click would unmount their panels in the same gesture
        // that opened them. Dismissal is useDismiss's outside-press and Escape; a tap back in the
        // post closes it, and InsertDialog covers it whole on the two rows that open one.
        <div
          data-testid='insert-menu-panel'
          className='absolute right-0 top-full z-50 mt-1 flex min-w-max flex-col items-start gap-0.5 rounded border border-zinc-300 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900'>
          <InsertControls
            editor={editor}
            uploading={uploading}
            onImageChange={onImageChange}
            pickerTestId='image-picker-touch'
            labelled
            className='insert-menu-rows flex flex-col items-stretch gap-0.5'
          />
        </div>
      )}
    </div>
  );
}
