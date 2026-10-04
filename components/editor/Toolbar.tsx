'use client';

import { Fragment, useRef, type ChangeEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { ALLOWED_IMAGE_ACCEPT } from '@/lib/uploads';
import { selectionTouches } from './selection-scan';
import { IMAGE_BLOCKED_HOSTS } from './useImageUpload';
import { focusThenRun } from './focus-then-run';
import { ToolbarButton } from './ToolbarButton';
import { SHORTCUT } from './shortcut-catalog';
import { ToolbarDropdown, DropdownItem } from './ToolbarDropdown';
import { useInsertMenuNav } from './insert-menu-nav';
import { CalloutMenu } from './CalloutMenu';
import { TableGridMenu } from './TableGridMenu';
import { ImageIcon } from './svg/ImageIcon';
import { AccordionIcon } from './svg/AccordionIcon';
import { FootnoteIcon } from './svg/FootnoteIcon';
import { CodeBlockIcon } from './svg/CodeBlockIcon';
import { SummaryIcon } from './svg/SummaryIcon';
import { TldrIcon } from './svg/TldrIcon';
import { LinkIcon } from './svg/LinkIcon';
import { ListIcon } from './svg/ListIcon';
import { OrderedListIcon } from './svg/OrderedListIcon';
import { QuoteIcon } from './svg/QuoteIcon';
import { UndoIcon } from './svg/UndoIcon';
import { RedoIcon } from './svg/RedoIcon';

// Both list types in one dropdown, for a pointer only: inside the touch scroll strip a dropdown's
// panel is clipped (docs/editor-requirements.md §12.11), so touch gets two direct toggles. It
// highlights in any list and the open menu marks which kind.
function ListMenu({ editor }: { editor: Editor }) {
  const bullet = editor.isActive('bulletList');
  const ordered = editor.isActive('orderedList');

  // Both toggles refuse inside a code block (guarded-block-toggles.ts).
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
              onClick={() => select(() => focusThenRun(editor, (c) => c.toggleBulletList()))}
              active={bullet}>
              箇条書き
            </DropdownItem>
            <DropdownItem
              onClick={() => select(() => focusThenRun(editor, (c) => c.toggleOrderedList()))}
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
    <div className='toolbar-scroll flex min-w-0 flex-wrap items-center gap-0.5'>
      {/* Wraps on a pointer, scrolls horizontally on touch (§12.11, app/globals.css). `min-w-0` is
          load-bearing: without it the item can't shrink, so it widens the bar instead of scrolling. */}
      {/* H2/H3 (docs/editor-requirements.md §12.10); `title` carries the name. The span keeps
          B/I/S/A's flex structure minus `w-4`: as an inline span the button came out 1px taller.
          Weight 400: H2/H3 are not a preview of bold text.

          `wide` on every mark in this strip (§12.11): 24px was the AA floor, not a comfortable
          target, and the only reason it stayed that small was the row's width budget under
          `flex-wrap`. Once the strip scrolls instead of wrapping, that budget isn't scarce
          anymore, so every mark gets the same 40px undo/redo already had. */}
      <ToolbarButton
        onClick={() => focusThenRun(editor, (c) => c.toggleHeading({ level: 2 }))}
        active={editor.isActive('heading', { level: 2 })}
        disabled={!editor.can().toggleHeading({ level: 2 })}
        title={SHORTCUT.heading2.label}
        shortcut={SHORTCUT.heading2.token}
        compact
        wide>
        <span className='flex items-center justify-center text-sm leading-4'>H2</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => focusThenRun(editor, (c) => c.toggleHeading({ level: 3 }))}
        active={editor.isActive('heading', { level: 3 })}
        disabled={!editor.can().toggleHeading({ level: 3 })}
        title={SHORTCUT.heading3.label}
        shortcut={SHORTCUT.heading3.token}
        compact
        wide>
        <span className='flex items-center justify-center text-sm leading-4'>H3</span>
      </ToolbarButton>
      {/* `shrink-0`: an empty span's min-content width is 0, and the touch scroll strip shrank it
          away. */}
      <span
        className='toolbar-mark-divider mx-0.5 w-px shrink-0 self-stretch bg-zinc-300 dark:bg-zinc-600'
        aria-hidden='true'
      />
      <ToolbarButton
        onClick={() => focusThenRun(editor, (c) => c.toggleBold())}
        active={editor.isActive('bold')}
        disabled={!editor.can().toggleBold()}
        title={SHORTCUT.bold.label}
        shortcut={SHORTCUT.bold.token}
        compact
        wide>
        <span className='flex w-4 items-center justify-center text-sm leading-4 font-bold'>B</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => focusThenRun(editor, (c) => c.toggleItalic())}
        active={editor.isActive('italic')}
        disabled={!editor.can().toggleItalic()}
        title={SHORTCUT.italic.label}
        shortcut={SHORTCUT.italic.token}
        compact
        wide>
        <span className='flex w-4 items-center justify-center text-sm leading-4 font-serif italic -skew-x-6'>
          I
        </span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => focusThenRun(editor, (c) => c.toggleStrike())}
        active={editor.isActive('strike')}
        disabled={!editor.can().toggleStrike()}
        title={SHORTCUT.strike.label}
        shortcut={SHORTCUT.strike.token}
        compact
        wide>
        <span className='flex w-4 items-center justify-center text-sm leading-4 line-through'>
          S
        </span>
      </ToolbarButton>
      {/* No inline-code button: Mod-e and the `` `text` `` input and paste rules cover it. */}
      <ToolbarButton
        onClick={() => focusThenRun(editor, (c) => c.toggleAccentEmphasis())}
        active={editor.isActive('accentEmphasis')}
        disabled={!editor.can().toggleAccentEmphasis()}
        title={SHORTCUT.accentEmphasis.label}
        shortcut={SHORTCUT.accentEmphasis.token}
        compact
        wide>
        <span className='accent-emphasis flex w-4 items-center justify-center text-sm leading-4'>
          A
        </span>
      </ToolbarButton>
      <span
        className='toolbar-mark-divider mx-0.5 w-px shrink-0 self-stretch bg-zinc-300 dark:bg-zinc-600'
        aria-hidden='true'
      />
      {/* Two copies, one control (§12.11): the dropdown for a pointer, two toggles for touch.
          `list-dropdown`/`list-buttons` are the names §12.11 and the specs cite; `contents` keeps
          the controls direct flex items of this row. */}
      <span className='list-dropdown pointer-only contents'>
        <ListMenu editor={editor} />
      </span>
      <span className='list-buttons touch-only contents'>
        <ToolbarButton
          onClick={() => focusThenRun(editor, (c) => c.toggleBulletList())}
          active={editor.isActive('bulletList')}
          disabled={!editor.can().toggleBulletList()}
          title={SHORTCUT.bulletList.label}
          shortcut={SHORTCUT.bulletList.token}
          compact
          wide>
          <ListIcon />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => focusThenRun(editor, (c) => c.toggleOrderedList())}
          active={editor.isActive('orderedList')}
          disabled={!editor.can().toggleOrderedList()}
          title={SHORTCUT.orderedList.label}
          shortcut={SHORTCUT.orderedList.token}
          compact
          wide>
          <OrderedListIcon />
        </ToolbarButton>
      </span>
      {/* The insert group for a pointer; touch gets InsertMenu.tsx's copy. CSS decides which
          paints, avoiding a hydration mismatch (§12.4). `toolbar-insert` is the spec's handle. */}
      <InsertControls
        editor={editor}
        uploading={uploading}
        onImageChange={onImageChange}
        pickerTestId='image-picker'
        className='toolbar-insert pointer-only contents'
      />
      {/* Undo and redo, last in the row (§12.13), touch only: a phone keyboard has no Ctrl
          (§12.4). `historyControl`, not `wide`: the bare `<svg>` needs manual centring. */}
      {/* A divider ahead of the pair (§12.17): history is a different kind of action. */}
      <span
        className='toolbar-mark-divider mx-0.5 w-px shrink-0 self-stretch bg-zinc-300 dark:bg-zinc-600'
        aria-hidden='true'
      />
      <ToolbarButton
        // Not `focusThenRun`: undo is disabled until something has landed, which implies focus.
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title={SHORTCUT.undo.label}
        shortcut={SHORTCUT.undo.token}
        historyControl>
        <UndoIcon />
      </ToolbarButton>
      <ToolbarButton
        // As above: redo requires a prior undo.
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title={SHORTCUT.redo.label}
        shortcut={SHORTCUT.redo.token}
        historyControl>
        <RedoIcon />
      </ToolbarButton>
    </div>
  );
}

// The insert controls: occasional rather than mid-keystroke, so on a phone they live under the
// header's ＋ (docs/editor-requirements.md §12.5, §12.9). `pickerTestId` differs per copy, since
// the page has three file inputs and a shared testid would fail strict mode.
export function InsertControls({
  editor,
  uploading,
  onImageChange,
  pickerTestId,
  className,
  labelled,
}: {
  editor: Editor;
  uploading: boolean;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
  pickerTestId: string;
  className: string;
  // Draw the names beside the glyphs, for the ＋ menu (no tooltips under `hover: none`).
  labelled?: boolean;
}) {
  // Grey the picker out where useImageUpload refuses, using the refusal's own host list.
  const imageBlocked = selectionTouches(editor.state, ...Object.keys(IMAGE_BLOCKED_HOSTS));
  // `null` outside the drawer. One-gesture rows (引用/脚注/画像) close the sheet so the author sees
  // the edit.
  const nav = useInsertMenuNav();

  // Each row is built once and placed in a per-surface order below; only one branch mounts it.

  // A button that opens the hidden file input, not a <label> around it: a label is not focusable, so
  // the picker would drop out of the row's tab order.
  const imageInput = useRef<HTMLInputElement>(null);
  const image = (
    <Fragment key='image'>
      <ToolbarButton onClick={() => imageInput.current?.click()} disabled={imageBlocked}>
        <span className='flex items-center gap-1'>
          <ImageIcon />
          {uploading ? 'アップロード中…' : '画像'}
        </span>
      </ToolbarButton>
      <input
        ref={imageInput}
        data-testid={pickerTestId}
        type='file'
        accept={ALLOWED_IMAGE_ACCEPT}
        className='hidden'
        disabled={imageBlocked}
        onChange={(event) => {
          onImageChange(event);
          nav?.closeMenu();
        }}
      />
    </Fragment>
  );

  // Same command and `can()` guard as the slash menu's 「リンク」 row; the dialog picks card or
  // embed from the URL. Icon-only on a pointer, placed beside the other icon-only controls.
  const link = (
    <ToolbarButton
      key='link'
      onClick={() => {
        // Captured before `focusThenRun`, whose focus may settle a transaction that moves it.
        const from = editor.state.selection.from;
        focusThenRun(editor, (c) => c.openInsertDialog(from));
      }}
      disabled={!editor.can().openInsertDialog()}
      title='リンク'
      compact={!labelled}>
      {labelled ? (
        <span className='flex items-center gap-1'>
          <LinkIcon />
          リンク
        </span>
      ) : (
        <LinkIcon />
      )}
    </ToolbarButton>
  );

  // 引用 (§12.9): compact icon on a pointer, worded in the ＋ panel.
  const quote = (
    <ToolbarButton
      key='quote'
      onClick={() => {
        focusThenRun(editor, (c) => c.toggleBlockquote());
        nav?.closeMenu();
      }}
      active={editor.isActive('blockquote')}
      // `can()` already reports false in a table cell; the atom case is guarded in
      // blockquote-extension.ts. Enabled in a code block, which quoting wraps intact.
      disabled={!editor.can().toggleBlockquote()}
      title={SHORTCUT.blockquote.label}
      shortcut={SHORTCUT.blockquote.token}
      compact={!labelled}>
      {labelled ? (
        <span className='flex items-center gap-3'>
          <QuoteIcon />
          引用
        </span>
      ) : (
        <QuoteIcon />
      )}
    </ToolbarButton>
  );

  const callout = <CalloutMenu key='callout' editor={editor} labelled={labelled} />;

  const table = <TableGridMenu key='table' editor={editor} />;

  // No horizontal-rule button: h2's underline divides sections, and `---` covers the rare case.

  // Drawer-only rows (アコーディオン, コードブロック, TL;DR, まとめ, 脚注): the pointer toolbar declines them
  // (docs/accordion-requirements.md §7.9, docs/footnote-requirements.md §9), but the drawer is a
  // scrollable list, and their typed routes sit behind a phone keyboard's symbol layer.
  const accordion = labelled && (
    <ToolbarButton
      key='accordion'
      onClick={() => {
        focusThenRun(editor, (c) => c.setDetails());
        nav?.closeMenu();
      }}
      disabled={!editor.can().setDetails()}
      title='アコーディオン'>
      <span className='flex items-center gap-3'>
        <AccordionIcon />
        アコーディオン
      </span>
    </ToolbarButton>
  );

  const codeBlock = labelled && (
    <ToolbarButton
      key='code-block'
      onClick={() => {
        focusThenRun(editor, (c) => c.insertCodeBlock());
        nav?.closeMenu();
      }}
      disabled={!editor.can().insertCodeBlock()}
      title={SHORTCUT.codeBlock.label}
      shortcut={SHORTCUT.codeBlock.token}>
      <span className='flex items-center gap-3'>
        <CodeBlockIcon />
        コードブロック
      </span>
    </ToolbarButton>
  );

  // TL;DR and まとめ (docs/summary-requirements.md §9), greyed out once the post has one: `can()` is
  // the commands' own refusal, which covers the one-per-post rule and where each may go.
  const tldr = labelled && (
    <ToolbarButton
      key='tldr'
      onClick={() => {
        focusThenRun(editor, (c) => c.setTldr());
        nav?.closeMenu();
      }}
      disabled={!editor.can().setTldr()}
      title='TL;DR'>
      <span className='flex items-center gap-3'>
        <TldrIcon />
        TL;DR
      </span>
    </ToolbarButton>
  );

  const summary = labelled && (
    <ToolbarButton
      key='summary'
      onClick={() => {
        focusThenRun(editor, (c) => c.setSummary());
        nav?.closeMenu();
      }}
      disabled={!editor.can().setSummary()}
      title='まとめ'>
      <span className='flex items-center gap-3'>
        <SummaryIcon />
        まとめ
      </span>
    </ToolbarButton>
  );

  // The same `setFootnote` the `Mod-Shift-f` shortcut calls.
  const footnote = labelled && (
    <ToolbarButton
      key='footnote'
      onClick={() => {
        focusThenRun(editor, (c) => c.setFootnote());
        nav?.closeMenu();
      }}
      disabled={!editor.can().setFootnote()}
      title={SHORTCUT.footnote.label}
      shortcut={SHORTCUT.footnote.token}>
      <span className='flex items-center gap-3'>
        <FootnoteIcon />
        脚注
      </span>
    </ToolbarButton>
  );

  return (
    <div className={className}>
      {labelled
        ? [image, link, quote, callout, table, accordion, codeBlock, tldr, summary, footnote]
        : [callout, quote, link, table, image]}
    </div>
  );
}
