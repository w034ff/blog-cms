'use client';

import { useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { ALLOWED_IMAGE_ACCEPT } from '@/lib/uploads';
import { ToolbarButton } from './ToolbarButton';
import { useDismiss } from './useDismiss';
import { TableGridMenu } from './TableGridMenu';
import { ChevronIcon } from './svg/ChevronIcon';
import { ImageIcon } from './svg/ImageIcon';
import { ListIcon } from './svg/ListIcon';

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
      <label className='inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800'>
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
