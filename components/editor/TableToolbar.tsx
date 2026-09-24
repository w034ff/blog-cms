'use client';

import { useCallback, useMemo } from 'react';
import type { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { ToolbarButton } from './ToolbarButton';
import { AlignCenterIcon } from './svg/AlignCenterIcon';
import type { CellAlign } from './table-extensions';

// Table editing controls in a floating menu above the table the cursor is in. Appended to <body>
// so the editor's overflow-hidden can't clip it. z-20: above the content, below the sticky main
// toolbar's z-30 so its panels and tooltips are never covered.

// The row/column labels in two lengths (docs/editor-requirements.md §12.1): `＋行` below `sm`,
// `行を追加` above. Two CSS-switched spans rather than a media-query hook, so there is no wrong
// first render to hydrate against. The accessible name comes from `title` (as `aria-label`), so it
// stays 行を追加 at every width; the tooltip is hidden because it would only repeat the label.
function Label({ short, long }: { short: string; long: string }) {
  return (
    <>
      <span className='sm:hidden'>{short}</span>
      <span className='hidden sm:inline'>{long}</span>
    </>
  );
}

export function TableToolbar({ editor }: { editor: Editor }) {
  // BubbleMenu dispatches an editor transaction whenever shouldShow/appendTo/options/
  // getReferencedVirtualElement change by reference; with shouldRerenderOnTransaction
  // that re-renders us, so fresh inline props each render would loop forever
  // ("Maximum update depth"). Keep them all stable.
  const shouldShow = useCallback(() => editor.isActive('table'), [editor]);
  const appendTo = useCallback(() => document.body, []);
  const options = useMemo(
    // Padding so `shift` never puts the right edge exactly on the viewport's, which is past it on a
    // browser that disagrees with `100vw` (same as LinkBubble.tsx).
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
      // Default 250ms: after a block drag moves this table, the CSS suppression lifts at once and
      // the menu sat at its pre-drag spot until the debounced reposition. `0` takes the plugin's
      // synchronous branch (`updateDelay > 0` gates the debounce), repositioning before paint.
      updateDelay={0}
      shouldShow={shouldShow}
      appendTo={appendTo}
      options={options}
      getReferencedVirtualElement={getReferencedVirtualElement}
      // The width cap gives `flex-wrap` something to wrap against: an absolute box shrinks to its
      // containing block, wider than a phone, and ran off screen. `[&_button]:px-1.5` below `sm`
      // keeps the full-width labels (§12.1) on one line at 360px; the hit area stays 34x24, over
      // WCAG 2.5.8's 24x24.
      className='table-toolbar z-20 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-0.5 rounded border border-zinc-300 bg-white px-1 py-0.5 shadow-lg [&_button]:px-1.5 sm:[&_button]:px-2 dark:border-zinc-700 dark:bg-zinc-900'>
      <ToolbarButton onClick={() => editor.chain().focus().toggleHeaderRow().run()}>
        見出し行
      </ToolbarButton>
      <ToolbarButton
        title='行を追加'
        tooltipHidden
        onClick={() => editor.chain().focus().addRowAfter().run()}>
        <Label short='＋行' long='行を追加' />
      </ToolbarButton>
      <ToolbarButton
        title='行を削除'
        tooltipHidden
        onClick={() => editor.chain().focus().deleteRow().run()}>
        <Label short='－行' long='行を削除' />
      </ToolbarButton>
      <ToolbarButton
        title='列を追加'
        tooltipHidden
        onClick={() => editor.chain().focus().addColumnAfter().run()}>
        <Label short='＋列' long='列を追加' />
      </ToolbarButton>
      <ToolbarButton
        title='列を削除'
        tooltipHidden
        onClick={() => editor.chain().focus().deleteColumn().run()}>
        <Label short='－列' long='列を削除' />
      </ToolbarButton>
      <span className='mx-0.5 w-px self-stretch bg-zinc-300 dark:bg-zinc-600' aria-hidden='true' />
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
      <span className='mx-0.5 w-px self-stretch bg-zinc-300 dark:bg-zinc-600' aria-hidden='true' />
      <ToolbarButton destructive onClick={() => editor.chain().focus().deleteTable().run()}>
        表を削除
      </ToolbarButton>
    </BubbleMenu>
  );
}
