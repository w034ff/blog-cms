'use client';

import { useCallback, useMemo } from 'react';
import type { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { ToolbarButton } from './ToolbarButton';
import { AlignCenterIcon } from './svg/AlignCenterIcon';
import type { CellAlign } from './table-extensions';

// Table editing controls. TipTap ships no table UI, so these wire the table
// commands to buttons, shown in a floating menu anchored just above the selected
// table (shouldShow gates it to when the cursor is inside a table). Appended to
// <body> so the editor wrapper's overflow-hidden can't clip it, and it floats
// over the content instead of pushing it down. z-20 keeps it above the (unpositioned)
// editor content but below the sticky main toolbar's z-30 stacking context — the
// pinned toolbar and its dropdown panels/tooltips must never be covered by this menu.
export function TableToolbar({ editor }: { editor: Editor }) {
  // BubbleMenu dispatches an editor transaction whenever shouldShow/appendTo/options/
  // getReferencedVirtualElement change by reference; with shouldRerenderOnTransaction
  // that re-renders us, so fresh inline props each render would loop forever
  // ("Maximum update depth"). Keep them all stable.
  const shouldShow = useCallback(() => editor.isActive('table'), [editor]);
  const appendTo = useCallback(() => document.body, []);
  const options = useMemo(
    // `shift` carries a padding for the link card's reason (LinkBubble.tsx): satisfied without one,
    // it will place the toolbar's right edge exactly on the viewport's, which is the last pixel on a
    // browser that agrees with `100vw` and past it on one that does not.
    () => ({ placement: 'top-start' as const, offset: 8, flip: true, shift: { padding: 8 } }),
    [],
  );
  // Anchor the menu to the current table's top-left cell so it stays put while the
  // cursor moves between cells, instead of following the selection. floating-ui
  // positions relative to the returned element's bounding rect.
  const getReferencedVirtualElement = useCallback(() => {
    const domNode = editor.view.domAtPos(editor.state.selection.from).node;
    const el = domNode instanceof Element ? domNode : domNode.parentElement;
    const cell = el?.closest('table')?.querySelector('th, td') ?? null;
    return cell
      ? { getBoundingClientRect: () => cell.getBoundingClientRect(), contextElement: cell }
      : null;
  }, [editor]);
  // The current column's alignment, read from whichever cell type holds the cursor
  // (header or body), to light up the active button. shouldRerenderOnTransaction
  // keeps this current as the selection moves.
  const cellAlign: CellAlign =
    editor.getAttributes('tableCell').align ?? editor.getAttributes('tableHeader').align ?? null;
  return (
    <BubbleMenu
      editor={editor}
      pluginKey='tableMenu'
      // Default 250ms — fine normally, but a block drag (block-drag-handle.ts) that moves this
      // table lifts the `.table-toolbar` CSS suppression (globals.css) the instant the drag ends,
      // synchronously, before the drop's own transaction has repositioned the menu. With the
      // default delay that transaction's reposition is scheduled via `setTimeout(updateDelay)`, so
      // the menu visibly sits at its stale (pre-drag) spot for up to 250ms before jumping — exactly
      // the "moves from the old position to the new one" the drop was supposed to hide. `0` routes
      // the plugin through its synchronous branch instead (`updateDelay > 0` is what gates the
      // debounce), so the reposition lands in the same synchronous-plus-microtask window as the
      // drop itself, before the browser's next paint — no intermediate frame to see.
      updateDelay={0}
      shouldShow={shouldShow}
      appendTo={appendTo}
      options={options}
      getReferencedVirtualElement={getReferencedVirtualElement}
      // `flex-wrap` has always been here; what it lacked was a width to wrap against. An absolutely
      // positioned box sizes shrink-to-fit against its containing block, which is wider than a phone,
      // so the row stayed on one line and ran off the screen — measured at 441px against 390px, with
      // `shift` already pinned to the left edge (docs/table-requirements.md, §5.5.19's twin).
      className='table-toolbar z-20 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-0.5 rounded border border-zinc-300 bg-white px-1 py-0.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900'>
      <ToolbarButton onClick={() => editor.chain().focus().toggleHeaderRow().run()}>
        見出し行
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().addRowAfter().run()}>
        行を追加
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().deleteRow().run()}>
        行を削除
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().addColumnAfter().run()}>
        列を追加
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().deleteColumn().run()}>
        列を削除
      </ToolbarButton>
      <span className='mx-0.5 w-px self-stretch bg-zinc-400 dark:bg-zinc-600' aria-hidden='true' />
      {/* A single toggle: center the current column, or clear it back to the
          default (left) when it is already centered. */}
      <ToolbarButton
        title='列を中央揃え'
        active={cellAlign === 'center'}
        onClick={() =>
          editor
            .chain()
            .focus()
            .setColumnAlign(cellAlign === 'center' ? null : 'center')
            .run()
        }>
        <AlignCenterIcon />
      </ToolbarButton>
      {/* Whole-table delete: isolated at the far end behind its own divider and
          tinted red, so this destructive action isn't mis-hit among the additive
          row/column controls (a table can also be removed by selecting every cell
          and pressing Backspace). */}
      <span className='mx-0.5 w-px self-stretch bg-zinc-400 dark:bg-zinc-600' aria-hidden='true' />
      <ToolbarButton destructive onClick={() => editor.chain().focus().deleteTable().run()}>
        表を削除
      </ToolbarButton>
    </BubbleMenu>
  );
}
