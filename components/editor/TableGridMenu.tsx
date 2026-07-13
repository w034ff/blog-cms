'use client';

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { ToolbarDropdown } from './ToolbarDropdown';
import { TableIcon } from './svg/TableIcon';

// Upper bound of the size picker. The grid is only for creating the table — the
// TableToolbar grows it further (行を追加 / 列を追加), so this needn't be large.
const TABLE_PICKER_ROWS = 8;
const TABLE_PICKER_COLS = 8;

// Sanity caps for the numeric-input dialog (the escape hatch for tables larger than
// the grid). Kept modest so a stray keypress can't spawn a thousand-cell table.
const TABLE_MAX_ROWS = 50;
const TABLE_MAX_COLS = 20;

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

// Numeric-input fallback for the table picker: a modal with 行数 / 列数 fields for
// sizes beyond the grid. Uses the native <dialog> so Escape, the backdrop, focus
// trapping, and top-layer stacking come for free — no modal lib in the project.
function TableSizeDialog({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (rows: number, cols: number) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Kept as strings so a field can be cleared while typing; parsed and clamped on
  // submit.
  const [rows, setRows] = useState('3');
  const [cols, setCols] = useState('3');

  // showModal/close can't be expressed declaratively, so mirror the open prop onto
  // the real dialog from an effect, resetting the fields on each open.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setRows('3');
      setCols('3');
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const submit = () => {
    // Close the modal before inserting: while it's open the rest of the document is
    // inert and the editor transaction won't land. close() drops the inertness
    // synchronously, so the insert runs against a live editor.
    dialogRef.current?.close();
    onInsert(
      clamp(Number.parseInt(rows, 10) || 1, 1, TABLE_MAX_ROWS),
      clamp(Number.parseInt(cols, 10) || 1, 1, TABLE_MAX_COLS),
    );
  };

  const fieldClass =
    'w-20 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:text-zinc-100';

  return (
    <dialog
      ref={dialogRef}
      // Fires for both Escape and dialog.close(); keep React state in sync.
      onClose={onClose}
      // Backdrop click lands on the dialog element itself (content is in the inner
      // div), so a hit on the bare dialog means the backdrop was clicked.
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className='m-auto rounded-lg border border-zinc-300 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100'>
      {/* A plain <div>, not a <form>: the editor already sits inside PostEditor's
          <form>, and a nested form is invalid HTML — the browser drops it and the
          submit never fires. The 追加 button and Enter in a field both call submit(). */}
      <div className='flex flex-col gap-4 p-4'>
        <h2 className='text-sm font-medium'>表を追加</h2>
        <div
          className='flex items-end gap-3'
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}>
          <label className='flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400'>
            行数
            <input
              type='number'
              min={1}
              max={TABLE_MAX_ROWS}
              value={rows}
              onChange={(event) => setRows(event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className='flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400'>
            列数
            <input
              type='number'
              min={1}
              max={TABLE_MAX_COLS}
              value={cols}
              onChange={(event) => setCols(event.target.value)}
              className={fieldClass}
            />
          </label>
        </div>
        <div className='flex justify-end gap-2'>
          <button
            type='button'
            onClick={onClose}
            className='rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'>
            キャンセル
          </button>
          <button
            type='button'
            onClick={submit}
            className='rounded bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300'>
            追加
          </button>
        </div>
      </div>
    </dialog>
  );
}

// Table-insert control: a dropdown holding a grid of cells. Hovering (or focusing)
// a cell highlights the top-left block up to it and shows its size; clicking inserts
// a table of that many rows and columns. The first row is a header, matching the
// button's previous fixed 3×3 insert. Beats typing numbers — you see the shape you
// get.
export function TableGridMenu({ editor }: { editor: Editor }) {
  // The cell under the pointer/focus (1-indexed), defining the pending table size;
  // null when nothing is hovered, which clears the highlight and the size readout.
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const insert = (rows: number, cols: number) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    setHover(null);
  };

  return (
    <>
      <ToolbarDropdown
        trigger={
          <>
            <TableIcon />表
          </>
        }
        title='表'
        panelClass='flex-col gap-2 p-2'>
        {(close) => (
          <>
            <div
              className='grid gap-0.5'
              style={{ gridTemplateColumns: `repeat(${TABLE_PICKER_COLS}, 1rem)` }}
              onMouseLeave={() => setHover(null)}>
              {Array.from({ length: TABLE_PICKER_ROWS * TABLE_PICKER_COLS }, (_, i) => {
                // Fill row by row: the CSS grid has TABLE_PICKER_COLS columns, so the
                // flat index maps to (row, col) and lands in visual order.
                const rows = Math.floor(i / TABLE_PICKER_COLS) + 1;
                const cols = (i % TABLE_PICKER_COLS) + 1;
                const selected = hover !== null && rows <= hover.rows && cols <= hover.cols;
                return (
                  <button
                    key={i}
                    type='button'
                    aria-label={`${rows}行${cols}列の表を挿入`}
                    onMouseEnter={() => setHover({ rows, cols })}
                    onFocus={() => setHover({ rows, cols })}
                    onClick={() => {
                      insert(rows, cols);
                      close();
                    }}
                    className={`h-4 w-4 rounded-sm border ${
                      selected
                        ? 'border-blue-400 bg-blue-200 dark:border-blue-500 dark:bg-blue-500/40'
                        : 'border-zinc-300 dark:border-zinc-600'
                    }`}
                  />
                );
              })}
            </div>
            <div className='text-center text-xs tabular-nums text-zinc-600 dark:text-zinc-400'>
              {hover ? `${hover.rows} 行 × ${hover.cols} 列` : 'サイズを選択'}
            </div>
            <div className='-mx-2 border-t border-zinc-200 dark:border-zinc-700' />
            {/* Escape hatch for tables bigger than the grid: hand off to the numeric
                dialog. Close the dropdown first so they don't stack. */}
            <button
              type='button'
              onClick={() => {
                close();
                setHover(null);
                setDialogOpen(true);
              }}
              className='rounded px-2 py-1 text-xs text-zinc-800 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'>
              行数・列数を入力…
            </button>
          </>
        )}
      </ToolbarDropdown>
      {/* Modal top-layer dialog: DOM position is irrelevant, so it sits outside the
          dropdown (which is closed before it opens). */}
      <TableSizeDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onInsert={(rows, cols) => {
          insert(rows, cols);
          setDialogOpen(false);
        }}
      />
    </>
  );
}
