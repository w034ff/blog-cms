'use client';

import type { ChangeEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { ALLOWED_IMAGE_ACCEPT } from '@/lib/uploads';
import { selectionTouches } from './selection-scan';
import { IMAGE_BLOCKED_HOSTS } from './useImageUpload';
import { ToolbarButton } from './ToolbarButton';
import { ToolbarDropdown, DropdownItem } from './ToolbarDropdown';
import { CalloutMenu } from './CalloutMenu';
import { TableGridMenu } from './TableGridMenu';
import { ImageIcon } from './svg/ImageIcon';
import { ListIcon } from './svg/ListIcon';
import { QuoteIcon } from './svg/QuoteIcon';

// A single toolbar entry that folds the two list types into one control. It
// highlights whenever the cursor is in any list, and the open menu marks which
// kind — which the rendered bullets/numbers also show — so merging them doesn't
// hide the active state.
function ListMenu({ editor }: { editor: Editor }) {
  const bullet = editor.isActive('bulletList');
  const ordered = editor.isActive('orderedList');

  // Both toggles refuse inside a code block (guarded-block-toggles.ts), where converting
  // would shred it into prose; grey the trigger out rather than let a pick do that.
  const canList = editor.can().toggleBulletList() || editor.can().toggleOrderedList();

  return (
    <ToolbarDropdown
      trigger={<ListIcon />}
      title='リスト'
      active={bullet || ordered}
      disabled={!canList}>
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
  // An image is a block node, and none of the three hosts below can hold one: a table cell is
  // paragraph-only, a code block is a `code` textblock, and an accordion's title is `text*`.
  // Inserting splits the host in two around it and the saved markdown comes out corrupt every time
  // (see useImageUpload, which refuses for all three). Grey the picker out to match — using
  // ToolbarButton's own disabled treatment, since this control is a <label> + hidden <input>, not
  // a button. Paste and drag-and-drop hit the same refusal but have no affordance to grey out.
  // The host list is the refusal's own, so the two cannot drift on a selection that only reaches
  // into one of them (see selection-scan.ts).
  const imageBlocked = selectionTouches(editor.state, ...Object.keys(IMAGE_BLOCKED_HOSTS));

  return (
    <div className='flex flex-wrap items-center gap-0.5'>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })}
        disabled={!editor.can().toggleHeading({ level: 2 })}
        shortcut='Mod-Alt-2'>
        大見出し
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive('heading', { level: 3 })}
        disabled={!editor.can().toggleHeading({ level: 3 })}
        shortcut='Mod-Alt-3'>
        小見出し
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        disabled={!editor.can().toggleBold()}
        title='太字'
        shortcut='Mod-b'
        compact>
        <span className='flex w-4 items-center justify-center text-sm leading-4 font-bold'>B</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        disabled={!editor.can().toggleItalic()}
        title='斜体'
        shortcut='Mod-i'
        compact>
        <span className='flex w-4 items-center justify-center text-sm leading-4 font-serif italic -skew-x-6'>
          I
        </span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive('strike')}
        disabled={!editor.can().toggleStrike()}
        title='取り消し線'
        shortcut='Mod-Shift-s'
        compact>
        <span className='flex w-4 items-center justify-center text-sm leading-4 line-through'>
          S
        </span>
      </ToolbarButton>
      {/* Inline code has no toolbar button: it already has three entry points that cover both
          typing-as-you-go and marking already-typed text — Mod-e, the `` `text` `` input rule,
          and the matching paste rule (all from @tiptap/extension-code). */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleAccentEmphasis().run()}
        active={editor.isActive('accentEmphasis')}
        disabled={!editor.can().toggleAccentEmphasis()}
        title='強調'
        shortcut='Mod-Shift-e'
        compact>
        <span className='accent-emphasis flex w-4 items-center justify-center text-sm leading-4'>
          A
        </span>
      </ToolbarButton>
      <ListMenu editor={editor} />
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')}
        // Refuses in a paragraph-only table cell (table-extensions.ts). Unlike the heading and
        // list toggles above, no command guard is needed: toggleBlockquote already reports
        // false there rather than converting anything, so `can()` is the whole fix. It stays
        // enabled inside a code block on purpose — quoting one wraps it, keeping the block.
        disabled={!editor.can().toggleBlockquote()}
        title='引用'
        shortcut='Mod-Shift-b'
        compact>
        <QuoteIcon />
      </ToolbarButton>
      <CalloutMenu editor={editor} />
      {/* Code block has no toolbar button (it's a rare block): insert it from the `/` slash
          menu, the ```lang typing rule, or the Mod-Alt-c shortcut. */}
      <TableGridMenu editor={editor} />
      {/* Horizontal rule has no toolbar button: h2's red underline already carries the
          section-divider role, so this is left to the `---` + Enter input rule (StarterKit
          default) for the rare case someone wants an in-section break. */}
      {/* Image insert belongs in the toolbar too, but needs a file picker rather
          than an editor command, so it's a <label>-wrapped hidden input styled to
          match ToolbarButton. Paste and drag-and-drop also insert images.

          It keeps `cursor-pointer` of its own where the buttons beside it no longer
          need one: app/globals.css's base rule reaches `button`, and a <label> is
          not one — without this, the label's own text would hand back the I-beam.

          `toolbar-button` for the same reason, one rule further on: the touch-only ring
          (table-requirements.md §12.2) is written against that class, and being the one control in
          the row without a `<button>` under it left it as the one control in the row without an
          outline — on the phone where the outline is what says "press here". */}
      <label
        className={`toolbar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
          imageBlocked
            ? 'pointer-events-none opacity-40'
            : 'cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800'
        }`}>
        <ImageIcon />
        {uploading ? 'アップロード中…' : '画像'}
        {/* The editor page now has two file pickers — this one and the
            thumbnail field's — so both carry a testid. Without it a spec's
            `input[type="file"]` matches two elements and fails strict mode. */}
        <input
          data-testid='image-picker'
          type='file'
          accept={ALLOWED_IMAGE_ACCEPT}
          className='hidden'
          disabled={imageBlocked}
          onChange={onImageChange}
        />
      </label>
    </div>
  );
}
