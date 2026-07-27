'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ToolbarButton } from './ToolbarButton';
import { useDismiss } from './useDismiss';
import { ChevronIcon } from './svg/ChevronIcon';

// Shared skeleton of the toolbar's dropdown controls (list, callout, table): a
// ToolbarButton trigger with a chevron, the open/dismiss wiring, and a panel
// centered below the trigger. The panel body renders through a function child so
// items can close the menu after acting.
export function ToolbarDropdown({
  trigger,
  title,
  active,
  disabled,
  panelClass = 'min-w-max flex-col overflow-hidden px-1 py-0.5',
  children,
}: {
  // Trigger content (icon and/or text label); the chevron is appended after it.
  trigger: ReactNode;
  title: string;
  // Trigger highlight. Menus with a document-derived active state (the list menu)
  // pass theirs; insert-only menus omit it and highlight while open.
  active?: boolean;
  // Greys out the trigger where none of the panel's items would do anything, matching
  // how the plain toolbar buttons use `editor.can()`. The panel is gated on it too, so a
  // disabled trigger can never show its items.
  disabled?: boolean;
  // Interior layout of the panel; the default suits a plain column of items.
  panelClass?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  // Gating the panel on `!disabled` below hides it, but `open` outlives the trigger going disabled,
  // so the panel came back — with nobody clicking — as soon as the control was enabled again. The
  // dismiss hook doesn't cover it: it listens for mousedown and Escape, and the selection can move
  // without either (a command, a keyboard-driven change). So drop `open` on the transition into
  // disabled.
  //
  // Adjusted during render rather than in an effect. React's "You Might Not Need an Effect" names
  // resetting state on a prop change as the anti-pattern this replaces: the effect version runs
  // after the commit, so it costs an extra render pass and paints the stale state first. React
  // re-runs this component immediately instead, before children render or the DOM is touched. The
  // two effects in this codebase (useDismiss, useImageUpload) stay what they are — subscriptions to
  // document/window, which is what effects are for.
  const [prevDisabled, setPrevDisabled] = useState(disabled);
  if (disabled !== prevDisabled) {
    setPrevDisabled(disabled);
    if (disabled) setOpen(false);
  }

  return (
    <div ref={ref} className='relative flex'>
      <ToolbarButton
        onClick={() => setOpen((prev) => !prev)}
        active={active ?? open}
        disabled={disabled}
        title={title}
        tooltipHidden={open}>
        <span className='flex items-center gap-1'>
          {trigger}
          <ChevronIcon open={open} />
        </span>
      </ToolbarButton>
      {open && !disabled && (
        <div
          className={`absolute left-1/2 top-full z-50 mt-1 flex -translate-x-1/2 rounded border border-zinc-300 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${panelClass}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

// One row of a dropdown's item column — full-width and border-less so the hover
// highlight spans the whole panel edge-to-edge (the panel's overflow-hidden clips
// it to the rounded corners).
export function DropdownItem({
  onClick,
  active,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        active ? 'bg-zinc-200 dark:bg-zinc-700' : ''
      }`}>
      {children}
    </button>
  );
}
