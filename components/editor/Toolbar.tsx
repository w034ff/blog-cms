'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { ALLOWED_IMAGE_ACCEPT } from '@/lib/uploads';
import type { CellAlign } from './table-extensions';

function ToolbarButton({
  onClick,
  active,
  title,
  destructive,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  // Set for icon-only buttons, where it supplies both the hover tooltip and the
  // accessible name (text buttons don't need it — their label is the text).
  title?: string;
  // Red tint for a destructive action (e.g. delete the whole table), so it reads as
  // "danger" and isn't mistaken for the neutral controls beside it.
  destructive?: boolean;
  children: ReactNode;
}) {
  const tone = destructive
    ? 'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950 dark:hover:text-red-300'
    : 'hover:bg-zinc-100 dark:hover:bg-zinc-800';
  return (
    <button
      type='button'
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 ${tone} ${
        active ? 'bg-zinc-200 dark:bg-zinc-700' : ''
      }`}>
      {children}
    </button>
  );
}

// Bulleted-list glyph: three dots stacked at the left with a bar beside each —
// the platform-standard "list" mark. Inherits the button's color via currentColor.
function ListIcon() {
  return (
    <svg
      viewBox='0 0 24 24'
      className='block h-4 w-4'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'>
      <line x1='8' y1='6' x2='21' y2='6' />
      <line x1='8' y1='12' x2='21' y2='12' />
      <line x1='8' y1='18' x2='21' y2='18' />
      <line x1='3' y1='6' x2='3.01' y2='6' />
      <line x1='3' y1='12' x2='3.01' y2='12' />
      <line x1='3' y1='18' x2='3.01' y2='18' />
    </svg>
  );
}

// Chevron beside the list icon, signalling this is the toolbar's one menu-opening
// button (the rest fire immediately). Rotates to point up while the menu is open.
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox='0 0 24 24'
      className={`block h-3 w-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'>
      <path d='m6 9 6 6 6-6' />
    </svg>
  );
}

// Framed-photo glyph (frame, sun, mountain) for the image-insert button, in the
// same stroke style as the other toolbar icons.
function ImageIcon() {
  return (
    <svg
      viewBox='0 0 24 24'
      className='block h-4 w-4'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'>
      <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
      <circle cx='8.5' cy='8.5' r='1.5' />
      <polyline points='21 15 16 10 5 21' />
    </svg>
  );
}

// Center-align glyph for the table column-alignment button: four horizontal rules,
// the middle two shortened and centered, in the same stroke style as the other
// toolbar icons.
function AlignCenterIcon() {
  return (
    <svg
      viewBox='0 0 24 24'
      className='block h-4 w-4'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'>
      <line x1='3' y1='6' x2='21' y2='6' />
      <line x1='6' y1='10' x2='18' y2='10' />
      <line x1='3' y1='14' x2='21' y2='14' />
      <line x1='6' y1='18' x2='18' y2='18' />
    </svg>
  );
}

// Grid glyph for the table-insert button: a framed box with a continuous header
// row across the top and a 2×2 body, in the same stroke style as the other icons.
function TableIcon() {
  return (
    <svg
      viewBox='0 0 24 24'
      className='block h-4 w-4'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'>
      <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
      <line x1='3' y1='9' x2='21' y2='9' />
      <line x1='3' y1='15' x2='21' y2='15' />
      <line x1='12' y1='9' x2='12' y2='21' />
    </svg>
  );
}

// One row of the list menu. Full-width and border-less so the hover highlight
// spans the whole dropdown edge-to-edge, instead of sitting inside a bordered
// button box (the container clips these to its rounded corners).
function ListMenuItem({
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
      className={`px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        active ? 'bg-zinc-200 dark:bg-zinc-700' : ''
      }`}>
      {children}
    </button>
  );
}

// Close an open dropdown when the user clicks outside it or presses Escape. No
// dropdown lib is in the project, so the toolbar's menus (list, table) share this.
// onClose is read through a ref so passing a fresh inline closure each render
// doesn't re-subscribe the listeners — they attach once per open/close.
function useDismiss<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onCloseRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  return ref;
}

// A single toolbar entry that folds the two list types into one control. It
// highlights whenever the cursor is in any list, and the open menu marks which
// kind — which the rendered bullets/numbers also show — so merging them doesn't
// hide the active state.
function ListMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  const bullet = editor.isActive('bulletList');
  const ordered = editor.isActive('orderedList');
  const select = (toggle: () => void) => {
    toggle();
    setOpen(false);
  };

  return (
    <div ref={ref} className='relative'>
      <ToolbarButton
        onClick={() => setOpen((prev) => !prev)}
        active={bullet || ordered}
        title='リスト'>
        <span className='flex items-center gap-0.5'>
          <ListIcon />
          <ChevronIcon open={open} />
        </span>
      </ToolbarButton>
      {open && (
        <div className='absolute left-1/2 top-full z-50 mt-1 flex min-w-max -translate-x-1/2 flex-col overflow-hidden rounded border border-zinc-300 bg-white px-1 py-0.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900'>
          <ListMenuItem
            onClick={() => select(() => editor.chain().focus().toggleBulletList().run())}
            active={bullet}>
            箇条書き
          </ListMenuItem>
          <ListMenuItem
            onClick={() => select(() => editor.chain().focus().toggleOrderedList().run())}
            active={ordered}>
            番号付き
          </ListMenuItem>
        </div>
      )}
    </div>
  );
}

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
function TableGridMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  // The cell under the pointer/focus (1-indexed), defining the pending table size;
  // null when nothing is hovered, which clears the highlight and the size readout.
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  const insert = (rows: number, cols: number) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    setOpen(false);
    setHover(null);
  };

  return (
    <div ref={ref} className='relative'>
      <ToolbarButton onClick={() => setOpen((prev) => !prev)} active={open} title='表'>
        <span className='flex items-center gap-1'>
          <TableIcon />
          表
          <ChevronIcon open={open} />
        </span>
      </ToolbarButton>
      {open && (
        <div className='absolute left-1/2 top-full z-50 mt-1 flex -translate-x-1/2 flex-col gap-2 rounded border border-zinc-300 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900'>
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
                  onClick={() => insert(rows, cols)}
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
              setOpen(false);
              setHover(null);
              setDialogOpen(true);
            }}
            className='rounded px-2 py-1 text-xs text-zinc-800 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'>
            行数・列数を入力…
          </button>
        </div>
      )}
      <TableSizeDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onInsert={(rows, cols) => {
          insert(rows, cols);
          setDialogOpen(false);
        }}
      />
    </div>
  );
}

// Format controls. Each command is also reachable by markdown shortcut while
// typing (e.g. `# `, `- `), so the author can format either way.
export function Toolbar({
  editor,
  uploading,
  onImageChange,
}: {
  editor: Editor;
  uploading: boolean;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className='flex flex-wrap items-center gap-1'>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })}>
        大見出し
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive('heading', { level: 3 })}>
        小見出し
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}>
        太字
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}>
        斜体
      </ToolbarButton>
      <ListMenu editor={editor} />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')}>
        引用
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive('codeBlock')}>
        コードブロック
      </ToolbarButton>
      <TableGridMenu editor={editor} />
      <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        区切り線
      </ToolbarButton>
      {/* Image insert belongs in the toolbar too, but needs a file picker rather
          than an editor command, so it's a <label>-wrapped hidden input styled to
          match ToolbarButton. Paste and drag-and-drop also insert images. */}
      <label className='inline-flex cursor-pointer items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'>
        <ImageIcon />
        {uploading ? 'アップロード中…' : '画像'}
        <input
          type='file'
          accept={ALLOWED_IMAGE_ACCEPT}
          className='hidden'
          onChange={onImageChange}
        />
      </label>
    </div>
  );
}

// Table editing controls. TipTap ships no table UI, so these wire the table
// commands to buttons, shown in a floating menu anchored just above the selected
// table (shouldShow gates it to when the cursor is inside a table). Appended to
// <body> so the editor wrapper's overflow-hidden can't clip it, and it floats
// over the content instead of pushing it down.
export function TableToolbar({ editor }: { editor: Editor }) {
  // BubbleMenu dispatches an editor transaction whenever shouldShow/appendTo/options/
  // getReferencedVirtualElement change by reference; with shouldRerenderOnTransaction
  // that re-renders us, so fresh inline props each render would loop forever
  // ("Maximum update depth"). Keep them all stable.
  const shouldShow = useCallback(() => editor.isActive('table'), [editor]);
  const appendTo = useCallback(() => document.body, []);
  const options = useMemo(
    () => ({ placement: 'top-start' as const, offset: 8, flip: true, shift: true }),
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
      shouldShow={shouldShow}
      appendTo={appendTo}
      options={options}
      getReferencedVirtualElement={getReferencedVirtualElement}
      className='z-50 flex flex-wrap items-center gap-1 rounded border border-zinc-300 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900'>
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
