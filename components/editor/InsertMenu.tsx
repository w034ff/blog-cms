'use client';

import { useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { InsertControls } from './Toolbar';
import { ToolbarButton } from './ToolbarButton';
import { useDismiss } from './useDismiss';
import { useBodyScrollLock } from './useBodyScrollLock';
import { InsertMenuNavContext } from './insert-menu-nav';
import { PlusIcon } from './svg/PlusIcon';
import { ArrowLeftIcon } from './svg/ArrowLeftIcon';

const INSERT_MENU_HEADING_ID = 'insert-menu-heading';

// The phone's home for 囲み枠・表・リンク・画像 (docs/table-requirements.md §12.5). The format
// controls moved to a bar at the bottom of the screen, where the caret and the thumb are; these
// four did not go with them, because they are not wanted mid-keystroke and the bottom bar has no
// width to spare once the software keyboard is up.
//
// Drawn only under `hover: none` — `touch-only` on the root hides the whole component, trigger and
// panel together, by one rule in app/globals.css. Written that way rather than as a `matchMedia`
// read in React for the reason §12.1 and §12.4 give: a media query in React renders one way and
// corrects itself, which is a hydration mismatch. The controls themselves are `InsertControls`,
// the same component the toolbar renders for a pointer — two copies in the DOM, one painted.
//
// **The panel is a bottom sheet (§12.18, 2026-09-18), not the small anchored box §12.15's
// screenshot showed** — the note precedent it was modelled on opens this way rather than as a
// dropdown. A full-width `fixed` sheet doesn't need an anchor at all, which sidesteps the ＋
// trigger's own position entirely (no `right-0`/`left-0` choice to make, no header-wrap-width
// dependency the old static anchor had).
//
// **The trigger's own accessible name is not 「挿入」.** `getByRole`'s `name` matches a substring
// by default, so 挿入 would also select 挿入する (InsertDialog) and 2行2列の表を挿入 — and the
// table buttons are inside this very panel, visible at the same moment. The sheet's visible
// heading (2026-09-19, on note's and Google Docs' own precedent) is「挿入」as plain text, not a
// button, so it doesn't collide with either — the panel points to it with `aria-labelledby`
// instead of repeating the string as its own accessible name.
export function InsertMenu({
  editor,
  uploading,
  onImageChange,
  open,
  onOpenChange,
}: {
  editor: Editor;
  uploading: boolean;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
  // Controlled, not local state: PostEditor.tsx also has to reopen this sheet from InsertDialog
  // (リンク's own picker), which is its own sibling rather than a descendant — mousedown anywhere
  // inside that dialog closes this sheet as a side effect of `useDismiss` before the author ever
  // reaches a cancel button (insert-menu-nav.ts's own comment has the measurement), so cancelling
  // has to explicitly reopen it rather than merely not-close it.
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Only the sheet itself is inside `ref` — the backdrop covers the whole screen, so there is no
  // "outside" left for useDismiss's own outside-press check to catch. The backdrop gets its own
  // `onClick` instead (below).
  const ref = useDismiss<HTMLDivElement>(open, () => onOpenChange(false));
  useBodyScrollLock(open);

  // Which row's picker (if any) is drilled into, and the DOM node it portals into — see
  // insert-menu-nav.ts for why this is a portal target rather than a `view` snapshot that would
  // unmount CalloutMenu/TableGridMenu and orphan their own state. `portalNode` is set from a
  // callback ref below; the slot renders unconditionally (only `hidden` toggles), so it is
  // attached before any trigger can ever be tapped.
  const [activeTitle, setActiveTitle] = useState<string | null>(null);
  const [portalNode, setPortalNode] = useState<HTMLDivElement | null>(null);
  const deactivate = () => setActiveTitle(null);
  // Reset to the row list on every fresh open, not on close: the sheet stays mounted (only the
  // portal's JSX unmounts) while `open` cycles, so a stale `activeTitle` would otherwise survive a
  // close and reopen. Adjusted during render, the same idiom ToolbarDropdown.tsx uses for its own
  // open-tracked state, rather than an effect that would paint the stale view first.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setActiveTitle(null);
  }

  // `createPortal` to `document.body`, not rendered in place: this component lives inside
  // PostEditor.tsx's header, which is `sticky` with its own `z-40` — a stacking context. A `fixed`
  // descendant does not escape that for z-index purposes, so the sheet's own `z-50` was only ever
  // compared *within* the header's stack, not against `.editor-toolbar-bar` (also `z-40`, but
  // later in the DOM, which wins ties at the top level). Measured 2026-09-18: the sheet's own
  // `getBoundingClientRect()` fully contained the bar's, yet the bar painted over it — the portal
  // moves the sheet out from under the header entirely, the same reason `InsertDialog` is mounted
  // straight from PostEditor.tsx rather than from wherever its own trigger happens to sit.

  return (
    // `insert-menu` is the hook the `hover: hover` rule hides.
    <div className='insert-menu touch-only flex'>
      <ToolbarButton
        onClick={() => onOpenChange(!open)}
        active={open}
        title='ブロックを追加'
        tooltipHidden={open}
        round>
        <PlusIcon />
      </ToolbarButton>
      {open &&
        createPortal(
          <>
            {/* The backdrop: dims the post and the format bar underneath (z-45, above the bar's
                z-40) and closes the sheet on a tap anywhere outside it. */}
            <div
              className='fixed inset-0 z-[45] bg-black/40'
              aria-hidden='true'
              onClick={() => onOpenChange(false)}
            />
            {/* Covers the format bar rather than sitting above it (both note and Google Docs hide
                their own toolbar behind this same drawer, checked directly against both).
                `bottom` matches the bar's own `var(--editor-kb-inset, 0px)` (app/globals.css) so
                the sheet clears a software keyboard the same way the bar does — Android's layout
                viewport already shrinks under the keyboard (`resizes-content`), but iOS's does
                not, and this is measured for that case.

                A column, and the controls keep their row shape inside it: these are
                ToolbarButtons, and their own touch height (44px here, `.insert-menu-rows
                .toolbar-button` in app/globals.css — the app-wide floor elsewhere is 40px) is
                what makes the rows pressable.

                **`min-h-[44vh] max-h-[44vh]`, a pinned height rather than a floor (2026-09-20).**
                Raising the rows to 44px grew the row list's own content past the sheet height
                that had been settled on (~370px against an 839px-tall phone, i.e. ~44vh — the
                value this pin reuses) — rather than let the sheet grow to match (which the
                previous `min-h-[47vh]`/`max-h-[70vh]` pair did), the sheet stays put and
                `overflow-y-auto` scrolls the row list internally for the rows that no longer fit
                (requested 2026-09-20: keep the drawer the height it already was). A drilled-in
                picker (表/囲み枠) is short enough that this pin still reads as its own floor for
                it, the same way `min-h-[47vh]` briefly did for both surfaces at once — re-measure
                if that stops being true (a picker gains enough rows to also need to scroll).

                **Choosing a row does not close this sheet.** 囲み枠 and 表 are themselves drawer
                triggers (`insert-menu-nav.ts`): tapping one swaps the sheet's own body for that
                row's picker, in place, and picking an item there returns to the row list rather
                than closing the sheet whole. Dismissal is the backdrop, Escape (useDismiss), and
                InsertDialog covering the sheet whole on the two rows that open one.

                **`rounded-t-lg` (8px, 2026-09-19).** `rounded-t-2xl` matched neither reference —
                Google Docs' own sheet has square corners, note's has some but visibly less than
                2xl — and square (tried first, same day) read as too flat a departure from note,
                the precedent this drawer is modelled on. Compared 4/6/8px side by side (screenshot)
                and picked 8px; none of the three is measured against either app's own radius. */}
            <div
              ref={ref}
              data-testid='insert-menu-panel'
              role='dialog'
              aria-labelledby={INSERT_MENU_HEADING_ID}
              // `insert-menu-panel` (a class, not the testid above) is the slide-up-on-open hook —
              // app/globals.css, gated on `prefers-reduced-motion` the same way html's smooth
              // scroll is (requested 2026-09-20).
              className='insert-menu-panel fixed inset-x-0 bottom-[var(--editor-kb-inset,0px)] z-50 min-h-[44vh] max-h-[44vh] overflow-y-auto rounded-t-lg border-t border-zinc-300 bg-white pb-2 shadow-[0_-4px_16px_rgba(0,0,0,0.12)] dark:border-zinc-700 dark:bg-zinc-900'>
              {/* Had a drag-handle bar here (mx-auto h-1 w-10 rounded-full) — removed 2026-09-19:
                  purely decorative with no drag-to-dismiss gesture behind it, and that mismatch
                  outweighed the note-precedent affordance it was standing in for. */}
              {/* One heading, one id, throughout: swapping in a second `<h2 id=...>` for the
                  drilled-in state (an earlier version of this did) left two elements sharing
                  `aria-labelledby`'s target once neither branch unmounted any more — see the
                  portal-target comment below for why both now stay mounted. 戻る only when a
                  picker is active; 挿入 itself has nowhere to go back to.

                  `min-h-10` (40px) matches every row below it (`.insert-menu-rows
                  .toolbar-button`, 40px under `hover: none`) and 戻る's own touch box, so the
                  header reads as one more row in the same list rather than a shorter strip above
                  it. No `pb-2` here (unlike the rest of the sheet): that padding used to stack on
                  TOP of 戻る's 40px box, taking the drilled-in header to 49px against the row
                  list's 40px — measured via `getBoundingClientRect()`, not eyeballed.

                  The sheet's own `pt-2` (above, on the panel div) is gone for the same reason: it
                  added an 8px gap before the header that no row gets before it, so even at an equal
                  40px the header's own text sat 18.5px from the panel's top edge against 10.5px to
                  the border below it — asymmetric padding read as "this row is bigger" even though
                  the box wasn't. `items-center` alone (≈10px above the text) still clears the
                  `rounded-t-lg` corner.

                  The divider itself moved to `border-t` on the two content wrappers below (was
                  `border-b` here): on this element it was part of the header's own border-box, so
                  it stacked on top of 戻る's 40px content in the drilled-in state (41px) but got
                  absorbed into the row-list state's `min-h-10` clamp (still 40px, since a min-height
                  that already has to stretch the box swallows a 1px border for free) — a 1px
                  mismatch from the same clamp/no-clamp asymmetry as the `pb-2` one above, just an
                  order of magnitude smaller. Moving the border off the clamped element removes the
                  asymmetry instead of chasing it with another pixel value. */}
              <div className='flex min-h-10 items-center gap-1 px-2'>
                {activeTitle && (
                  <ToolbarButton onClick={() => setActiveTitle(null)} title='戻る'>
                    <ArrowLeftIcon />
                  </ToolbarButton>
                )}
                {/* `pl-2` only without 戻る: 挿入 needs it to reach the rows' own 16px icon inset
                    (container's `px-2` alone falls 8px short, measured). With 戻る, it's dropped —
                    stacked on the container's own `gap-1` plus the button's own padding, `pl-2`
                    put ~20px between the arrow and 囲み枠/表/… against the row list's 12px `gap-3`
                    between an icon and its own label (measured) — and widening the container's own
                    `px-2` instead (tried first) pushed 戻る itself 8px right of the sheet's other
                    edge-aligned controls, which is a bigger tell than the header's internal gap
                    being a few px looser. `pr-2` stays unconditional: the trailing space before the
                    header's own right edge isn't part of either problem. */}
                <h2
                  id={INSERT_MENU_HEADING_ID}
                  className={`pr-2 text-sm font-light text-black dark:text-zinc-100 ${activeTitle ? '' : 'pl-2'}`}>
                  {activeTitle ?? '挿入'}
                </h2>
              </div>
              {/* Both stay mounted always — only `hidden` toggles — so CalloutMenu's and
                  TableGridMenu's own component instances (and the state on them) survive a row
                  being drilled into and backed out of. No horizontal padding on the row list
                  itself (2026-09-19): the rows go edge to edge under app/globals.css's
                  `.insert-menu-rows .toolbar-button` rule, which is where their own `px-4` lives
                  instead. `divide-y` stands in for the gap as a row separator, thin enough not to
                  read as a card boundary. `border-t` here is the header/content divider that used
                  to be the header's own `border-b` — see the comment above it. */}
              <div
                hidden={activeTitle !== null}
                className='border-t border-zinc-300 dark:border-zinc-700'>
                <InsertMenuNavContext.Provider
                  value={{
                    activeTitle,
                    activate: setActiveTitle,
                    deactivate,
                    portalTarget: portalNode,
                    closeMenu: () => onOpenChange(false),
                  }}>
                  <InsertControls
                    editor={editor}
                    uploading={uploading}
                    onImageChange={onImageChange}
                    pickerTestId='image-picker-touch'
                    labelled
                    className='insert-menu-rows flex flex-col items-stretch divide-y divide-zinc-300 dark:divide-zinc-700'
                  />
                </InsertMenuNavContext.Provider>
              </div>
              {/* The portal target a row's own `ToolbarDropdown` (CalloutMenu, TableGridMenu)
                  renders its picker into — see insert-menu-nav.ts. Rendered unconditionally so
                  `portalNode` is attached (via the callback ref) before any trigger can be tapped,
                  rather than only once a picker is first active. `border-t` is the same
                  header/content divider as the row list's own wrapper above. No `py-2` or `px-4`
                  (like the row list, which has neither of its own): `py-2` put 8px of air above
                  情報 and below 警告 that the row list doesn't have above 囲み枠 or below 画像, and
                  `px-4` stacked on TOP OF `.insert-menu-drilldown .dropdown-item`'s own
                  `padding-left: 1rem` (app/globals.css) — 32px of icon indent against the row
                  list's 16px, measured via `getBoundingClientRect()`. Both are the same "row list
                  has no padding of its own, the row/item's own padding does the indenting"
                  pattern the comment above this element's sibling already states, just not
                  carried over to this element when it was written. */}
              <div
                ref={setPortalNode}
                hidden={activeTitle === null}
                className='insert-menu-drilldown flex flex-col items-stretch border-t border-zinc-300 dark:border-zinc-700'
              />
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
