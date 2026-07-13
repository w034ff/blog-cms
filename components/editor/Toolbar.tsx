'use client';

import type { ChangeEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { ALLOWED_IMAGE_ACCEPT } from '@/lib/uploads';
import { ToolbarButton } from './ToolbarButton';
import { ToolbarDropdown, DropdownItem } from './ToolbarDropdown';
import { CalloutMenu } from './CalloutMenu';
import { TableGridMenu } from './TableGridMenu';
import { ImageIcon } from './svg/ImageIcon';
import { ListIcon } from './svg/ListIcon';

// A single toolbar entry that folds the two list types into one control. It
// highlights whenever the cursor is in any list, and the open menu marks which
// kind — which the rendered bullets/numbers also show — so merging them doesn't
// hide the active state.
function ListMenu({ editor }: { editor: Editor }) {
  const bullet = editor.isActive('bulletList');
  const ordered = editor.isActive('orderedList');

  return (
    <ToolbarDropdown trigger={<ListIcon />} title='リスト' active={bullet || ordered}>
      {(close) => {
        const select = (toggle: () => void) => {
          toggle();
          close();
        };
        return (
          <>
            <DropdownItem
              onClick={() => select(() => editor.chain().focus().toggleBulletList().run())}
              active={bullet}>
              箇条書き
            </DropdownItem>
            <DropdownItem
              onClick={() => select(() => editor.chain().focus().toggleOrderedList().run())}
              active={ordered}>
              番号付き
            </DropdownItem>
          </>
        );
      }}
    </ToolbarDropdown>
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
    <div className='flex flex-wrap items-center gap-0.5'>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })}
        shortcut='Mod-Alt-2'>
        大見出し
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive('heading', { level: 3 })}
        shortcut='Mod-Alt-3'>
        小見出し
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        title='太字'
        shortcut='Mod-b'>
        <span className='flex items-center text-sm leading-4 font-bold'>B</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        title='斜体'
        shortcut='Mod-i'>
        <span className='flex items-center text-sm leading-4 font-serif italic -skew-x-6 '>I</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive('strike')}
        title='取り消し線'
        shortcut='Mod-Shift-s'>
        <span className='flex items-center text-sm leading-4 line-through'>S</span>
      </ToolbarButton>
      <ListMenu editor={editor} />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')}
        shortcut='Mod-Shift-b'>
        引用
      </ToolbarButton>
      <CalloutMenu editor={editor} />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive('codeBlock')}
        shortcut='Mod-Alt-c'>
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
