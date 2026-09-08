'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ToolbarButton } from './ToolbarButton';
import { useDismiss } from './useDismiss';
import { ChevronIcon } from './svg/ChevronIcon';

// How far the panel is kept from the viewport edge by clampPanelToViewport below.
const VIEWPORT_MARGIN = 8;

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
  const panelRef = useRef<HTMLDivElement>(null);
  // How far to nudge the panel off its natural centered position so it stays on screen. The panel
  // is centered under the trigger (`left-1/2`, translated below), which assumes there's room on
  // both sides — true on a wide toolbar, but the main toolbar wraps (`flex-wrap`), and which row a
  // trigger lands in shifts with viewport width. The table picker is the widest panel here (an 8×8
  // grid), so it's the one that first lands near an edge after wrapping: measured, the trigger
  // itself sits comfortably inside 300–460px throughout, but past 420px it wraps to a row where
  // it's near the *left* edge, and the centered panel then runs 14px+ past the left edge of the
  // viewport (reported 2026-09-05). Fixed here rather than by reordering the toolbar: the wrap
  // position is a function of viewport width, not of button order, so any reordering only moves
  // which width breaks — every ToolbarDropdown (list, callout, table) shares this component and
  // the same latent risk. Not a touch/hover concern (contrast the tooltip and touch-ring rules in
  // app/globals.css) — a narrow desktop window or a high zoom level hits the same geometry.
  const [shiftX, setShiftX] = useState(0);
  useLayoutEffect(() => {
    if (!open) {
      setShiftX(0);
      return;
    }
    const recompute = () => {
      const trigger = ref.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const triggerRect = trigger.getBoundingClientRect();
      const panelWidth = panel.offsetWidth;
      const naturalLeft = triggerRect.left + triggerRect.width / 2 - panelWidth / 2;
      // clientWidth, not window.innerWidth: a classic (non-overlay) vertical scrollbar is part of
      // innerWidth but sits outside the content viewport a getBoundingClientRect coordinate can
      // actually reach, so clamping against innerWidth on a long post would still let the panel's
      // right edge land under the scrollbar. Same metric editor-narrow-menus.spec.ts's own
      // margins()/pageWidth() already clamp against, for the same reason.
      const viewportWidth = document.documentElement.clientWidth;
      const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - panelWidth);
      const clampedLeft = Math.min(Math.max(naturalLeft, VIEWPORT_MARGIN), maxLeft);
      setShiftX(clampedLeft - naturalLeft);
    };
    recompute();
    // Rotation while the panel is open moves the trigger without closing the panel first
    // (useDismiss only reacts to a pointer or Escape), so the clamp has to be redone rather than
    // left stale until the next open.
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [open, ref]);

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
          ref={panelRef}
          data-testid='toolbar-dropdown-panel'
          // The -50% here is what left-1/2 + -translate-x-1/2 used to do as Tailwind utilities;
          // it has to move into the inline style once shiftX needs to add to the same transform,
          // since the utility and an inline `transform` can't both win.
          style={{ transform: `translateX(calc(-50% + ${shiftX}px))` }}
          className={`absolute left-1/2 top-full z-50 mt-1 flex rounded border border-zinc-300 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${panelClass}`}>
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
      className={`dropdown-item px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        active ? 'bg-zinc-200 dark:bg-zinc-700' : ''
      }`}>
      {children}
    </button>
  );
}
