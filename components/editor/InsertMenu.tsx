'use client';

import { useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { InsertControls } from './Toolbar';
import { ToolbarButton } from './ToolbarButton';
import { useDismiss } from './useDismiss';
import { InsertMenuNavContext } from './insert-menu-nav';
import { PlusIcon } from './svg/PlusIcon';
import { ArrowLeftIcon } from './svg/ArrowLeftIcon';

const INSERT_MENU_HEADING_ID = 'insert-menu-heading';

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
}: {
  editor: Editor;
  uploading: boolean;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const [open, setOpen] = useState(false);
  // Only the sheet itself is inside `ref` — the backdrop covers the whole screen, so there is no
  // "outside" left for useDismiss's own outside-press check to catch. The backdrop gets its own
  // `onClick` instead (below).
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

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
    <div className='insert-menu flex'>
      <ToolbarButton
        onClick={() => setOpen((prev) => !prev)}
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
              onClick={() => setOpen(false)}
            />
            {/* Covers the format bar rather than sitting above it (both note and Google Docs hide
                their own toolbar behind this same drawer, checked directly against both).
                `bottom` matches the bar's own `var(--editor-kb-inset, 0px)` (app/globals.css) so
                the sheet clears a software keyboard the same way the bar does — Android's layout
                viewport already shrinks under the keyboard (`resizes-content`), but iOS's does
                not, and this is measured for that case.

                A column, and the controls keep their row shape inside it: these are
                ToolbarButtons, and their own touch height (40px, `hover: none`) is what makes the
                rows pressable. `max-h-[70vh]` plus its own `overflow-y-auto` keeps a tall keyboard
                from pushing the sheet's own top off-screen — the five rows never approach that
                height today, but nothing here assumes they stay five. `min-h-[40vh]` (2026-09-18,
                raised from an initial 33vh that barely moved anything — five rows alone already
                settled around 32% of a 740px screen) gives the sheet real presence at rest.

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
              className='fixed inset-x-0 bottom-[var(--editor-kb-inset,0px)] z-50 min-h-[40vh] max-h-[70vh] overflow-y-auto rounded-t-lg border-t border-zinc-300 bg-white pt-2 pb-2 shadow-[0_-4px_16px_rgba(0,0,0,0.12)] dark:border-zinc-700 dark:bg-zinc-900'>
              {/* Had a drag-handle bar here (mx-auto h-1 w-10 rounded-full) — removed 2026-09-19:
                  purely decorative with no drag-to-dismiss gesture behind it, and that mismatch
                  outweighed the note-precedent affordance it was standing in for. */}
              {/* One heading, one id, throughout: swapping in a second `<h2 id=...>` for the
                  drilled-in state (an earlier version of this did) left two elements sharing
                  `aria-labelledby`'s target once neither branch unmounted any more — see the
                  portal-target comment below for why both now stay mounted. 戻る only when a
                  picker is active; 挿入 itself has nowhere to go back to. */}
              <div className='flex items-center gap-1 border-b border-zinc-300 px-2 pb-2 dark:border-zinc-700'>
                {activeTitle && (
                  <ToolbarButton onClick={() => setActiveTitle(null)} title='戻る'>
                    <ArrowLeftIcon />
                  </ToolbarButton>
                )}
                <h2
                  id={INSERT_MENU_HEADING_ID}
                  className='px-2 text-sm font-light text-black dark:text-zinc-100'>
                  {activeTitle ?? '挿入'}
                </h2>
              </div>
              {/* Both stay mounted always — only `hidden` toggles — so CalloutMenu's and
                  TableGridMenu's own component instances (and the state on them) survive a row
                  being drilled into and backed out of. No horizontal padding on the row list
                  itself (2026-09-19): the rows go edge to edge under app/globals.css's
                  `.insert-menu-rows .toolbar-button` rule, which is where their own `px-4` lives
                  instead. `divide-y` stands in for the gap as a row separator, thin enough not to
                  read as a card boundary. */}
              <div hidden={activeTitle !== null}>
                <InsertMenuNavContext.Provider
                  value={{
                    activeTitle,
                    activate: setActiveTitle,
                    deactivate,
                    portalTarget: portalNode,
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
                  rather than only once a picker is first active. */}
              <div
                ref={setPortalNode}
                hidden={activeTitle === null}
                className='insert-menu-drilldown flex flex-col items-stretch px-4 py-2'
              />
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
