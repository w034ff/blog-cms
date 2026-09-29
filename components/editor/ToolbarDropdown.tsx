'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { ToolbarButton } from './ToolbarButton';
import { useDismiss } from './useDismiss';
import { ChevronIcon } from './svg/ChevronIcon';
import { useInsertMenuNav } from './insert-menu-nav';

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
  // Inside the ＋ drawer this portals into the sheet's slot instead (insert-menu-nav.ts); `open`
  // then never turns true, so the floating panel's effects stay inert.
  const nav = useInsertMenuNav();
  const isActive = nav !== null && nav.activeTitle === title;
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const panelRef = useRef<HTMLDivElement>(null);
  // How far to nudge the centered panel so it stays on screen. Where a trigger sits depends on
  // viewport width, so reordering buttons would only move which width breaks; every dropdown
  // shares this clamp.
  const [shiftX, setShiftX] = useState(0);
  useLayoutEffect(() => {
    if (!open) return;
    const recompute = () => {
      const trigger = ref.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const triggerRect = trigger.getBoundingClientRect();
      const panelWidth = panel.offsetWidth;
      const naturalLeft = triggerRect.left + triggerRect.width / 2 - panelWidth / 2;
      // clientWidth, not innerWidth, which includes a classic vertical scrollbar.
      const viewportWidth = document.documentElement.clientWidth;
      const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - panelWidth);
      const clampedLeft = Math.min(Math.max(naturalLeft, VIEWPORT_MARGIN), maxLeft);
      setShiftX(clampedLeft - naturalLeft);
    };
    recompute();
    // Rotation moves the trigger without closing the panel.
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [open, ref]);

  // Drop `open` when the trigger becomes disabled; otherwise the panel reappears unbidden when it is
  // re-enabled. Adjusted during render, not in an effect ("You Might Not Need an Effect"), so the
  // stale state is never painted.
  const [prevDisabled, setPrevDisabled] = useState(disabled);
  if (disabled !== prevDisabled) {
    setPrevDisabled(disabled);
    if (disabled) setOpen(false);
  }

  // The clamp is reset on close, the same way; the layout effect recomputes it before the next paint.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setShiftX(0);
  }

  return (
    <div ref={ref} className='relative flex'>
      <ToolbarButton
        onClick={() => (nav ? nav.activate(title) : setOpen((prev) => !prev))}
        active={active ?? (nav ? isActive : open)}
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
          // -50% is inline because shiftX adds to the same transform.
          style={{ transform: `translateX(calc(-50% + ${shiftX}px))` }}
          // `toolbar-dropdown-panel` carries the entrance fade (app/globals.css,
          // docs/editor-requirements.md §12.37).
          className={`toolbar-dropdown-panel absolute left-1/2 top-full z-50 mt-1 flex rounded border border-zinc-300 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${panelClass}`}>
          {children(() => setOpen(false))}
        </div>
      )}
      {/* The drawer copy of the panel, portalled into the sheet's slot so this fiber (and the
          menus' state) stays put. Only the tapped row (`isActive`) renders into the shared slot.
          `close` is `nav.deactivate`, back to the row list, because "行数・列数を入力…" calls it
          mid-flow; a successful pick calls `nav.closeMenu()` itself. */}
      {isActive &&
        nav &&
        nav.portalTarget &&
        createPortal(
          children(() => nav.deactivate()),
          nav.portalTarget,
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
