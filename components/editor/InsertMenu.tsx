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

// The phone's home for the insert controls (docs/editor-requirements.md §12.5), as a bottom sheet
// modelled on note's and Google Docs' (§12.18). Shown only under `hover: none` via `touch-only`
// (app/globals.css) rather than a `matchMedia` read, which would be a hydration mismatch;
// `InsertControls` is the same component the pointer toolbar renders.
//
// **The trigger's accessible name is not 「挿入」:** `getByRole`'s `name` matches substrings, so it
// would also select 挿入する and 2行2列の表を挿入. The sheet's heading 「挿入」 is plain text,
// referenced by `aria-labelledby`.
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
  // Controlled: InsertDialog is a sibling, and a mousedown in it closes this sheet via useDismiss,
  // so PostEditor.tsx has to reopen the sheet when the dialog is cancelled.
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Only the sheet is inside `ref`; the full-screen backdrop closes on its own `onClick`.
  const ref = useDismiss<HTMLDivElement>(open, () => onOpenChange(false));
  useBodyScrollLock(open);

  // Which row's picker is drilled into, and the node it portals into (insert-menu-nav.ts).
  const [activeTitle, setActiveTitle] = useState<string | null>(null);
  const [portalNode, setPortalNode] = useState<HTMLDivElement | null>(null);
  const deactivate = () => setActiveTitle(null);
  // Reset to the row list on each open, during render (as in ToolbarDropdown.tsx) so the stale
  // view is never painted.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setActiveTitle(null);
  }

  // Portalled to `document.body`: the sticky header is a `z-40` stacking context, so a `fixed` sheet
  // inside it painted under `.editor-toolbar-bar` (§12.18).

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
            {/* Covers the format bar (§12.18). `bottom` uses the bar's `--editor-kb-inset` so the
                sheet clears an iOS keyboard as the bar does.

                **A pinned height, `min-h-[44vh] max-h-[44vh]`:** the row list scrolls inside it
                rather than growing the sheet. Re-measure if a drilled-in picker ever needs to
                scroll too. 囲み枠 and 表 drill in place (insert-menu-nav.ts); the corner radius is
                §12.18's. */}
            <div
              ref={ref}
              data-testid='insert-menu-panel'
              role='dialog'
              aria-labelledby={INSERT_MENU_HEADING_ID}
              // `insert-menu-panel` (the class) is the slide-up hook in app/globals.css.
              className='insert-menu-panel fixed inset-x-0 bottom-[var(--editor-kb-inset,0px)] z-50 min-h-[44vh] max-h-[44vh] overflow-y-auto rounded-t-lg border-t border-zinc-300 bg-white pb-2 shadow-[0_-4px_16px_rgba(0,0,0,0.12)] dark:border-zinc-700 dark:bg-zinc-900'>
              {/* One heading and one id in both states, so `aria-labelledby` never has two targets.
                  `min-h-10` makes the header exactly one 40px row in both states: no vertical
                  padding here or on the panel, and the divider is a `border-t` on the content
                  wrappers below, because on this element the `min-h` clamp absorbed it in one
                  state but not the other. */}
              <div className='flex min-h-10 items-center gap-1 px-2'>
                {activeTitle && (
                  <ToolbarButton onClick={() => setActiveTitle(null)} title='戻る'>
                    <ArrowLeftIcon />
                  </ToolbarButton>
                )}
                {/* `pl-2` only without 戻る: it aligns 挿入 with the rows' 16px icon inset, but beside
                    戻る it would open a wider gap than the rows' icon-to-label spacing. */}
                <h2
                  id={INSERT_MENU_HEADING_ID}
                  className={`pr-2 text-sm font-light text-black dark:text-zinc-100 ${activeTitle ? '' : 'pl-2'}`}>
                  {activeTitle ?? '挿入'}
                </h2>
              </div>
              {/* Both wrappers stay mounted (only `hidden` toggles), so the menus' state survives
                  drilling in and out. No padding of its own: rows go edge to edge and carry their
                  own `px-4` (`.insert-menu-rows .toolbar-button`, §12.19). */}
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
              {/* The portal target for a drilled-in picker, rendered unconditionally so the callback
                  ref is attached before any trigger is tapped. No padding of its own, like the row
                  list: `.insert-menu-drilldown .dropdown-item` does the indenting. */}
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
