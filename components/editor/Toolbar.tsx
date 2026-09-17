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
import { LinkIcon } from './svg/LinkIcon';
import { ListIcon } from './svg/ListIcon';
import { OrderedListIcon } from './svg/OrderedListIcon';
import { QuoteIcon } from './svg/QuoteIcon';
import { UndoIcon } from './svg/UndoIcon';
import { RedoIcon } from './svg/RedoIcon';

// A single toolbar entry that folds the two list types into one control, restored for a pointer
// only (§12.11's docs/table-requirements.md): the trigger + panel shape is what put a dropdown
// inside `.toolbar-scroll` on touch, where its own `overflow-x: auto` implicitly clips the panel's
// vertical overflow invisibly (CSS's overflow-x/-y coupling) — 箇条書き/番号付き are two direct
// touch-only toggles instead, and this dropdown is the pointer-only counterpart, picked by the same
// `contents`-vs-`display:none` idiom the insert group uses. It highlights whenever the cursor is in
// any list, and the open menu marks which kind — which the rendered bullets/numbers also show — so
// merging them doesn't hide the active state.
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
  return (
    <div className='flex items-center gap-0.5'>
      {/* Undo and redo stay outside the scroll strip (§12.11): pinned so a thumb doesn't have to
          chase them down a row that just moved under a scroll gesture. `shrink-0` keeps this group
          its own width regardless of how little room `.toolbar-scroll` gets squeezed to. */}
      <div className='toolbar-history flex shrink-0 items-center gap-0.5'>
        {/* Undo and redo, first in the row because that is where every editor puts them — and drawn
            only under `hover: none` (app/globals.css), since a pointer has the keyboard route.
            They exist for touch: `Mod-z` is the only other route and a phone keyboard has no
            Ctrl — Android offers no undo gesture at all, and the iOS one (shake, three-finger
            swipe) reaches the editor as a `beforeinput` of `inputType: historyUndo`, which
            prosemirror-view handles. Measured 2026-09-09: dispatching that event does undo, so
            iOS has a route and Android has none. The pair is `toolbar-button-history`, which
            is what widens them on touch (app/globals.css) — the row they cost there is already
            paid by their being present, so the width is free. */}
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title='元に戻す'
          shortcut='Mod-z'
          historyControl>
          <UndoIcon />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title='やり直す'
          shortcut='Mod-Shift-z'
          historyControl>
          <RedoIcon />
        </ToolbarButton>
      </div>
      {/* Everything else scrolls horizontally on touch instead of wrapping to a second row
          (§12.11) — `.toolbar-scroll` is `flex-wrap: wrap` here (pointer's unchanged behaviour,
          the same row it always was) and becomes `flex-nowrap; overflow-x: auto` only under
          `hover: none` (app/globals.css). `min-w-0` is load-bearing: a flex item won't shrink
          below its content's width otherwise, and an un-shrinkable item can't scroll — it pushes
          the bar itself wider instead. */}
      <div className='toolbar-scroll flex min-w-0 flex-wrap items-center gap-0.5'>
        {/* H2/H3, not 大見出し/小見出し (docs/table-requirements.md §12.10): the same abbreviation
          B/I/S/A already carry, so the row doesn't mix short glyphs with two spelled-out words.
          `title` moves this into the icon-button tooltip shape (name + shortcut) — the visible
          glyph alone no longer is the accessible name, the way it was when the button's own text
          read 大見出し.

          The span matches B/I/S/A's own structure (`flex items-center justify-center text-sm
          leading-4`) minus their fixed `w-4` — two characters don't fit the marks' single-letter
          box, so the width is left to the content instead. Dropping `flex`/`items-center` here,
          tried first, left the button 1px taller than its neighbours (25px vs 24, reported
          2026-09-17) — an inline span's line box doesn't centre the same way a flex item's does.

          Weight 400, matching 斜体/取り消し線 — not 強調, which reads bold (700) here because it
          is bold in the document too. H2/H3 aren't a preview of bold text, so they don't borrow
          its weight.

          `wide` on every mark in this strip (§12.11): 24px was the AA floor, not a comfortable
          target, and the only reason it stayed that small was the row's width budget under
          `flex-wrap`. Once the strip scrolls instead of wrapping, that budget isn't scarce
          anymore, so every mark gets the same 40px undo/redo already had. */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive('heading', { level: 2 })}
          disabled={!editor.can().toggleHeading({ level: 2 })}
          title='大見出し'
          shortcut='Mod-Alt-2'
          compact
          wide>
          <span className='flex items-center justify-center text-sm leading-4'>H2</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive('heading', { level: 3 })}
          disabled={!editor.can().toggleHeading({ level: 3 })}
          title='小見出し'
          shortcut='Mod-Alt-3'
          compact
          wide>
          <span className='flex items-center justify-center text-sm leading-4'>H3</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          disabled={!editor.can().toggleBold()}
          title='太字'
          shortcut='Mod-b'
          compact
          wide>
          <span className='flex w-4 items-center justify-center text-sm leading-4 font-bold'>
            B
          </span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          disabled={!editor.can().toggleItalic()}
          title='斜体'
          shortcut='Mod-i'
          compact
          wide>
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
          compact
          wide>
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
          compact
          wide>
          <span className='accent-emphasis flex w-4 items-center justify-center text-sm leading-4'>
            A
          </span>
        </ToolbarButton>
        {/* Two copies, one control (§12.11's docs/table-requirements.md): a pointer keeps the
            dropdown it always had (`.list-dropdown`), touch gets two direct toggles instead
            (`.list-buttons`) — a trigger + panel inside `.toolbar-scroll` inherits its
            `overflow-y: auto` (a side effect of setting only `overflow-x`), which clipped the
            dropdown's panel invisibly on touch; `getBoundingClientRect()`-based specs never caught
            it because clipping doesn't move a box's own geometry. `contents` on both spans, so
            either shape's own element(s) are flex items of this row directly, and one media query
            (app/globals.css) decides which span the `display: none` lands on. Both toggles refuse
            inside a code block (guarded-block-toggles.ts), where converting would shred it into
            prose — `ListMenu`'s trigger reads that from `editor.can()` too. */}
        <span className='list-dropdown contents'>
          <ListMenu editor={editor} />
        </span>
        <span className='list-buttons contents'>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive('bulletList')}
            disabled={!editor.can().toggleBulletList()}
            title='箇条書き'
            shortcut='Mod-Shift-8'
            compact
            wide>
            <ListIcon />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive('orderedList')}
            disabled={!editor.can().toggleOrderedList()}
            title='番号付き'
            shortcut='Mod-Shift-7'
            compact
            wide>
            <OrderedListIcon />
          </ToolbarButton>
        </span>
        {/* The insert group, rendered here for a pointer and inside the header's ＋ for touch
          (InsertMenu.tsx). Both copies are in the DOM at every width and one media query decides
          which is painted — the §12.4 idiom, for the reason stated there: a `matchMedia` read in
          React would render one way and correct itself, which is a hydration mismatch.

          `contents`, so on a pointer the four controls are flex items of the toolbar exactly as
          they were before this wrapper existed — the row wraps at the same widths. The hide rule
          is written `.editor-toolbar-bar .toolbar-insert` (two classes) so it outranks the
          `display: contents` this utility sets. */}
        <InsertControls
          editor={editor}
          uploading={uploading}
          onImageChange={onImageChange}
          pickerTestId='image-picker'
          className='toolbar-insert contents'
        />
      </div>
    </div>
  );
}

// 囲み枠・表・リンク・画像・引用 — controls a phone author reaches for occasionally rather than
// mid-keystroke, as opposed to marks like 太字 that apply to the word being typed. On a phone this
// group leaves the toolbar for a ＋ in the page header, where the bottom bar's width goes to what
// is used every sentence instead (docs/table-requirements.md §12.5, §12.9 for 引用 specifically —
// it shipped with the marks in §12.5 and moved out later, at the same frequency as 囲み枠).
//
// `pickerTestId` rather than a fixed one, because both copies carry a file input and
// `input[type="file"]` is already ambiguous on this screen — the thumbnail field has one too, which
// is why the picker has a testid at all. Two copies of the same testid would fail strict mode where
// two different ones do not.
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
  // Draw the names beside the glyphs. See CalloutMenu — the ＋ menu is a column of worded rows and
  // has no tooltips to fall back on, the toolbar is a row of icons that does.
  labelled?: boolean;
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
    <div className={className}>
      <CalloutMenu editor={editor} labelled={labelled} />
      {/* 引用 (§12.9): a pointer keeps it `compact` beside the toolbar's other icons; the ＋ panel's
          rows are worded (labelled), the same asymmetry CalloutMenu's own trigger has and for the
          same reason — no tooltip exists under `hover: none`. */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')}
        // Refuses in a paragraph-only table cell (table-extensions.ts) with no command guard
        // needed there — toggleBlockquote already reports false rather than converting anything,
        // so `can()` is the whole fix. It stays enabled inside a code block on purpose — quoting
        // one wraps it, keeping the block. A NodeSelection over a linkCard/embed is a separate
        // case that does need a guard (blockquote-extension.ts), since wrapIn happily wraps a
        // selected atom instead of refusing.
        disabled={!editor.can().toggleBlockquote()}
        title='引用'
        shortcut='Mod-Shift-b'
        compact={!labelled}>
        {labelled ? (
          <span className='flex items-center gap-1'>
            <QuoteIcon />
            引用
          </span>
        ) : (
          <QuoteIcon />
        )}
      </ToolbarButton>
      {/* Code block has no toolbar button (it's a rare block): insert it from the `/` slash
          menu, the ```lang typing rule, or the Mod-Alt-c shortcut. */}
      <TableGridMenu editor={editor} />
      {/* Same command and target position as the slash menu's 「リンク」 row (slash-command.ts):
          the dialog itself decides link card vs. embed from the URL, so one entry point covers
          both. `can()` mirrors that row's `available` guard — greyed out in a paragraph-only
          table cell, where neither outcome could land. */}
      <ToolbarButton
        onClick={() => editor.chain().focus().openInsertDialog(editor.state.selection.from).run()}
        disabled={!editor.can().openInsertDialog()}
        title='リンク'>
        <span className='flex items-center gap-1'>
          <LinkIcon />
          リンク
        </span>
      </ToolbarButton>
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
        {/* The editor page has three file pickers — this one, the ＋ menu's copy of it, and the
            thumbnail field's — so each carries a testid. Without them a spec's
            `input[type="file"]` matches three elements and fails strict mode. */}
        <input
          data-testid={pickerTestId}
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
