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

// The 行数 / 列数 fields + キャンセル/追加, laid out for TableSizeDialog's own small floating
// card (fields side by side, buttons bottom-right) — the pointer's grid-escape-hatch only; the
// touch drawer uses TableSizeRows below instead, a different layout on the same state shape, not
// a variant of this one (see that component's own comment on why they diverge). Kept as strings
// so a field can be cleared while typing; parsed and clamped on submit. Mounted fresh each time it
// becomes visible (TableSizeDialog only renders this while `open`), so `'3'` as the initial value
// is the only reset it needs.
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

// One 行数/列数 row: label left, a −/+ stepper right — no text field, so no software keyboard
// pops up for the common case (2026-09-20, replacing this row's own first draft, a number
// `<input>`). Clamped the same way the input's `clamp(parseInt(...) || 1, 1, max)` was, just
// applied a step at a time instead of parsed from typed text.
function SizeStepper({
  icon,
  label,
  value,
  max,
  onChange,
}: {
  // Same icon-then-label shape every other drawer row uses (画像/リンク/…/コードブロック,
  // Toolbar.tsx) — 行数/列数 were the one row-shaped thing left in the sheet without one
  // (requested 2026-09-20): TableRowsIcon/TableColumnsIcon.
  icon: ReactNode;
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  // No resting border/ring — 0516af5 dropped that everywhere else in this drawer on purpose
  // (ToolbarButton.tsx's own comment: pressability at rest is the glyph, not a box around it).
  // `active:` matches `.toolbar-button:active`'s own colors (app/globals.css) rather than
  // `bg-zinc-200`/`-700`, which is ToolbarButton's "this is currently ON" state, not a press.
  // 40px button in a 48px row (settled 2026-09-20, after 32px/40px and 48px/48px tries): this row
  // is a label plus two separate steppers, not one tap target, so it isn't bound to the app's
  // usual "the row IS the button, so they're the same figure" 40px floor either way.
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

// The 行数/列数 steppers as full-width rows (min-h-10, divide-y, px-4 edges) — matching every
// other row in the ＋ drawer, both the row list itself (InsertMenu.tsx's `.insert-menu-rows`) and
// 囲み枠's own drilled-in picker (`.dropdown-item`, app/globals.css) — plus 表を追加, a full-width
// button of its own rather than a bordered pill (compared side by side against a right-aligned
// and a header-placed version, 2026-09-20; picked for the same reason a full-width row is easier
// to hit than a small one — it just isn't a *tap-anywhere* row like 引用/脚注/画像, since the
// steppers above it still need their own precise targets). Worded 表を追加, not bare 追加: this
// sheet's own header already reads 表 once drilled in, but the button sits right after two rows
// that are ABOUT a table without naming one themselves. TableSizeDialog's own 追加 stays bare —
// its dialog heading already reads 表を追加 immediately above it, which this row doesn't have. No
// キャンセル: the sheet's own 戻る (InsertMenu.tsx) already backs out to the row list, so a second
// cancel control here would duplicate it (requested 2026-09-20).
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
      {/* `pt-4`, not `py-2` both sides (2026-09-20): 列数's own row is 48px with a 40px stepper
          inside it, so its bottom edge sits only a few px above this button's top — close enough
          that a repeated +/− tap (aiming at the stepper, not this button) could land low and hit
          it instead. The extra top gap is deliberate slack, not visual balance. */}
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

// Numeric-input fallback for the pointer's grid: a modal for sizes beyond it. Uses
// the native <dialog> so Escape, the backdrop, focus trapping, and top-layer
// stacking come for free — no modal lib in the project.
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

  // showModal/close can't be expressed declaratively, so mirror the open prop onto the real
  // dialog from an effect. TableSizeFields is only rendered while `open` (below), so it remounts
  // — and its own fields reset — on every reopen without this effect touching them itself.
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
      {/* A plain <div>, not a <form>: the editor already sits inside PostEditor's
          <form>, and a nested form is invalid HTML — the browser drops it and the
          submit never fires.

          `onMouseDown` stops here for the same reason InsertDialog.tsx's own content div does:
          this dialog is portalled to `document.body` (above), outside InsertMenu.tsx's own
          `ref` — its `useDismiss` closes the whole ＋ sheet on any mousedown it doesn't contain,
          and a click in here would otherwise both fire that (unmounting this dialog's own portal
          mid-click, so `submit()` never runs) and do whatever it's actually for. Confirmed by
          reproducing: 追加 visibly received the click (`elementFromPoint` agreed) yet `submit()`
          never logged, until this stopped the bubble. */}
      <div className='flex flex-col gap-4 p-4' onMouseDown={(event) => event.stopPropagation()}>
        <h2 className='text-sm font-medium'>表を追加</h2>
        {open && (
          <TableSizeFields
            onCancel={onClose}
            onInsert={(rows, cols) => {
              // Close the modal before inserting: while it's open the rest of the document is
              // inert and the editor transaction won't land. close() drops the inertness
              // synchronously, so the insert runs against a live editor.
              dialogRef.current?.close();
              onInsert(rows, cols);
            }}
          />
        )}
      </div>
    </dialog>
  );
}

// Table-insert control. On a pointer: a dropdown holding a grid of cells — hovering
// (or focusing) a cell highlights the top-left block up to it and shows its size;
// clicking inserts a table of that many rows and columns. Beats typing numbers — you
// see the shape you get, because hovering previews it before the click commits.
//
// That preview does not exist on touch — a tap both focuses and clicks in the same
// gesture, so the highlight only ever appears at the same moment the table is
// already inserted — and the grid's own cells (h-4 w-4, 16px) sit well under the
// 40px touch target every other drawer row uses. So the touch drawer skips the grid
// entirely: drilling into 表 there goes straight to TableSizeRows — a 行数/列数 stepper laid out
// as drawer rows, not TableSizeFields' text-field-and-buttons form the pointer keeps as its
// grid's escape hatch (requested 2026-09-20).
export function TableGridMenu({ editor }: { editor: Editor }) {
  // The cell under the pointer/focus (1-indexed), defining the pending table size;
  // null when nothing is hovered, which clears the highlight and the size readout.
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // `null` outside the drawer (the pointer toolbar's own floating panel) — see insert-menu-nav.ts.
  const nav = useInsertMenuNav();

  // The one place both success paths meet: the grid cell's own onClick below, and the numeric
  // dialog's 追加 (TableSizeDialog's `onInsert`). `nav?.closeMenu()` here closes the sheet whole
  // for both, on top of the grid cell's own `close()` ("back to the row list") — a pick here is as
  // final as 引用/脚注/画像 tapping their own row (2026-09-20). The numeric dialog's *opening*
  // ("行数・列数を入力…", below) does NOT call this — the table isn't inserted yet at that point.
  const insert = (rows: number, cols: number) => {
    focusThenRun(editor, (c) => c.insertTable({ rows, cols, withHeaderRow: true }));
    setHover(null);
    nav?.closeMenu();
  };

  // insertTable refuses where a table can't go — anywhere the selection touches an existing table,
  // since a cell is paragraph-only and inserting would have replaced or split the host
  // (table-extensions.ts). Ask the command rather than re-testing the context here, and grey the
  // trigger out instead of opening a picker whose every cell silently does nothing; the panel is
  // gated on the same flag, so the "行数・列数を入力…" dialog behind it is unreachable too. This is
  // the insert control only — row/column editing lives in the floating TableToolbar, which appears
  // precisely when this one greys out, so nothing is taken away. Size arguments are irrelevant to
  // the refusal, so the dry run is asked without them.
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
            // Touch drawer: straight to the row-styled fields, no grid — see this component's own
            // comment, and TableSizeRows' for why it isn't just TableSizeFields reused.
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
                      // The one exception to the pointer every button gets in app/globals.css, and
                      // it overrides that rule as a utility rather than by editing it (`@layer
                      // base` is what makes that work). A cell is a <button> so the grid can be
                      // swept by keyboard as well, but 64 of them are read as one sizing surface,
                      // not as 64 controls — the size comes off the 「行 × 列」 readout below
                      // rather than from aiming at a particular square. The 行数・列数を入力…
                      // button under it is an ordinary control and keeps the pointer.
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
      {/* Pointer only — the touch drawer has no grid to escape from, so nothing ever opens this.
          Portalled to `document.body`, not left in place: `showModal()` promotes a `<dialog>` to
          the top layer, but a top-layer element still doesn't paint while any ancestor is
          `display:none`, and this same component also mounts (undisplayed) under exactly that
          once a touch drawer row is drilled into elsewhere (InsertMenu.tsx's `hidden` on the
          row-list wrapper). Same fix InsertDialog already uses, for a related reason (a
          stacking-context ancestor there, a display:none one here). */}
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
