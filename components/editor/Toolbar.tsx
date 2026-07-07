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
  children,
}: {
  onClick: () => void;
  active?: boolean;
  // Set for icon-only buttons, where it supplies both the hover tooltip and the
  // accessible name (text buttons don't need it — their label is the text).
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 ${
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

// A single toolbar entry that folds the two list types into one control. It
// highlights whenever the cursor is in any list, and the open menu marks which
// kind — which the rendered bullets/numbers also show — so merging them doesn't
// hide the active state. No dropdown lib is in the project, so it wires its own
// outside-click / Escape close.
function ListMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

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
        <div className='absolute left-0 top-full z-50 mt-1 flex min-w-max flex-col overflow-hidden rounded border border-zinc-300 bg-white px-1 py-0.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900'>
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
      <ToolbarButton
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }>
        表
      </ToolbarButton>
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
      <ToolbarButton onClick={() => editor.chain().focus().deleteTable().run()}>
        表を削除
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
    </BubbleMenu>
  );
}
