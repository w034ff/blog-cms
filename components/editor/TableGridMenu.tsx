'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { ToolbarDropdown } from './ToolbarDropdown';
import { useInsertMenuNav } from './insert-menu-nav';
import { focusThenRun } from './focus-then-run';
import { TableIcon } from './svg/TableIcon';
import { TableRowsIcon } from './svg/TableRowsIcon';
import { TableColumnsIcon } from './svg/TableColumnsIcon';

// Upper bound of the size picker. The grid is only for creating the table — the
// TableToolbar grows it further (行を追加 / 列を追加), so this needn't be large.
const TABLE_PICKER_ROWS = 8;
const TABLE_PICKER_COLS = 8;

// Sanity caps for the numeric-input dialog (the escape hatch for tables larger than
// the grid). Kept modest so a stray keypress can't spawn a thousand-cell table.
const TABLE_MAX_ROWS = 50;
const TABLE_MAX_COLS = 20;

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

// The 行数 / 列数 fields for the pointer's TableSizeDialog (touch uses TableSizeRows). Strings so a
// field can be cleared while typing; parsed and clamped on submit. Remounted on each open, so the
// initial `'3'` is the only reset needed.
function TableSizeFields({
  onInsert,
  onCancel,
}: {
  onInsert: (rows: number, cols: number) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState('3');
  const [cols, setCols] = useState('3');

  const submit = () => {
    onInsert(
      clamp(Number.parseInt(rows, 10) || 1, 1, TABLE_MAX_ROWS),
      clamp(Number.parseInt(cols, 10) || 1, 1, TABLE_MAX_COLS),
    );
  };

  const fieldClass =
    'w-20 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:text-zinc-100';

  return (
    <div
      className='flex flex-col gap-4'
      onKeyDown={(event) => {
        if (event.key === 'Enter') submit();
      }}>
      <div className='flex items-end gap-3'>
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
          onClick={onCancel}
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
  );
}

// One 行数/列数 row with a −/+ stepper, so no software keyboard pops up.
function SizeStepper({
  icon,
  label,
  value,
  max,
  onChange,
}: {
  // Icon-then-label, like every other drawer row.
  icon: ReactNode;
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  // No resting ring, as elsewhere in the drawer. `active:` uses `.toolbar-button:active`'s colours,
  // not the "currently ON" `bg-zinc-200`. A 40px button in a 48px row: the row holds two separate
  // targets, so it isn't itself the button.
  const stepButtonClass =
    'flex h-10 w-10 items-center justify-center rounded text-base leading-none text-zinc-700 hover:bg-zinc-100 active:bg-zinc-300 disabled:pointer-events-none disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:active:bg-zinc-600';

  return (
    <div className='flex min-h-12 items-center justify-between gap-3 px-4 text-sm text-zinc-900 dark:text-zinc-100'>
      <span className='flex items-center gap-3'>
        {icon}
        {label}
      </span>
      <div className='flex items-center gap-3'>
        <button
          type='button'
          aria-label={`${label}を減らす`}
          onClick={() => onChange(clamp(value - 1, 1, max))}
          disabled={value <= 1}
          className={stepButtonClass}>
          −
        </button>
        <span className='w-6 text-center tabular-nums' aria-live='polite'>
          {value}
        </span>
        <button
          type='button'
          aria-label={`${label}を増やす`}
          onClick={() => onChange(clamp(value + 1, 1, max))}
          disabled={value >= max}
          className={stepButtonClass}>
          +
        </button>
      </div>
    </div>
  );
}

// The touch drawer's table picker: 行数/列数 steppers as full-width rows matching the drawer, plus a
// full-width 表を追加 (worded, since the rows above don't name the table; the dialog's 追加 sits
// under a 表を追加 heading). No キャンセル: the sheet's 戻る already backs out.
function TableSizeRows({ onInsert }: { onInsert: (rows: number, cols: number) => void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);

  return (
    <div className='flex flex-col divide-y divide-zinc-300 dark:divide-zinc-700'>
      <SizeStepper
        icon={<TableRowsIcon />}
        label='行数'
        value={rows}
        max={TABLE_MAX_ROWS}
        onChange={setRows}
      />
      <SizeStepper
        icon={<TableColumnsIcon />}
        label='列数'
        value={cols}
        max={TABLE_MAX_COLS}
        onChange={setCols}
      />
      {/* `pt-4`: deliberate slack so a repeated −/+ tap that lands low doesn't hit this button. */}
      <div className='px-4 pt-4 pb-2'>
        <button
          type='button'
          onClick={() => onInsert(rows, cols)}
          className='w-full rounded bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300'>
          表を追加
        </button>
      </div>
    </div>
  );
}

// Numeric-input fallback for sizes beyond the pointer's grid, on a native <dialog> for Escape,
// backdrop, focus trapping and the top layer.
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

  // showModal/close are imperative, so the open prop is mirrored from an effect.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

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
      {/* A <div>, not a <form>: nested inside PostEditor's <form> it would be dropped
          (docs/editor-pitfalls.md §15.1). `onMouseDown` is stopped because this portalled dialog is
          outside the ＋ sheet's useDismiss ref, whose close would unmount it mid-click. */}
      <div className='flex flex-col gap-4 p-4' onMouseDown={(event) => event.stopPropagation()}>
        <h2 className='text-sm font-medium'>表を追加</h2>
        {open && (
          <TableSizeFields
            onCancel={onClose}
            onInsert={(rows, cols) => {
              // Close first: while modal the document is inert and the insert won't land.
              dialogRef.current?.close();
              onInsert(rows, cols);
            }}
          />
        )}
      </div>
    </dialog>
  );
}

// Table-insert control. On a pointer, a size grid whose hover previews the shape before the click.
// Touch has no hover preview and the 16px cells are under the 40px target, so the drawer goes
// straight to TableSizeRows.
export function TableGridMenu({ editor }: { editor: Editor }) {
  // The cell under the pointer/focus (1-indexed), defining the pending table size;
  // null when nothing is hovered, which clears the highlight and the size readout.
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // `null` outside the drawer (the pointer toolbar's own floating panel) — see insert-menu-nav.ts.
  const nav = useInsertMenuNav();

  // Where both success paths meet (grid cell, dialog's 追加). A pick is final, so the whole sheet
  // closes; opening the numeric dialog does not come through here.
  const insert = (rows: number, cols: number) => {
    focusThenRun(editor, (c) => c.insertTable({ rows, cols, withHeaderRow: true }));
    setHover(null);
    nav?.closeMenu();
  };

  // Ask insertTable itself (it refuses where the selection touches a table) and grey the trigger
  // out; TableToolbar appears exactly then. Size arguments don't affect the refusal.
  const canInsert = editor.can().insertTable();

  return (
    <>
      <ToolbarDropdown
        trigger={
          <span className='flex items-center gap-1'>
            <TableIcon />表
          </span>
        }
        title='表'
        disabled={!canInsert}
        panelClass='flex-col gap-2 p-2'>
        {(close) =>
          nav ? (
            // Touch drawer: steppers, no grid.
            <TableSizeRows
              onInsert={(rows, cols) => {
                insert(rows, cols);
                close();
              }}
            />
          ) : (
            <>
              <div
                className='grid justify-center gap-0.5'
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
                      // `cursor-default`: the 64 cells read as one sizing surface, not 64 controls.
                      className={`h-4 w-4 cursor-default rounded-sm border ${
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
          )
        }
      </ToolbarDropdown>
      {/* Pointer only. Portalled: a top-layer `<dialog>` still doesn't paint under a
          `display:none` ancestor, which the drawer's hidden row list can be. */}
      {!nav &&
        createPortal(
          <TableSizeDialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            onInsert={(rows, cols) => {
              insert(rows, cols);
              setDialogOpen(false);
            }}
          />,
          document.body,
        )}
    </>
  );
}
