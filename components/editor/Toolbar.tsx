'use client';

import type { ChangeEvent } from 'react';
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
// `pointer-only`/`touch-only` gate the insert group uses. It highlights whenever the cursor is in
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
      {/* Everything scrolls horizontally on touch instead of wrapping to a second row (§12.11) —
          `.toolbar-scroll` is `flex-wrap: wrap` here (pointer's unchanged behaviour, the same row
          it always was) and becomes `flex-nowrap; overflow-x: auto` only under `hover: none`
          (app/globals.css). `min-w-0` is load-bearing: a flex item won't shrink below its
          content's width otherwise, and an un-shrinkable item can't scroll — it pushes the bar
          itself wider instead. */}
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
      {/* `shrink-0`: an empty span's min-content width is 0, so the scroll strip's default
            flex-shrink (§12.11 makes it `flex-nowrap; overflow-x: auto` on touch, which shrinks
            items to fit before it lets them overflow into the scroll) squeezed this to 0 width
            first, ahead of the `wide` buttons whose own `min-width: 40px` stopped them from
            shrinking further — measured 2026-09-18, the divider was invisible at every width. */}
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
      {/* Inline code has no toolbar button: it already has three entry points that cover both
          typing-as-you-go and marking already-typed text — Mod-e, the `` `text` `` input rule,
          and the matching paste rule (all from @tiptap/extension-code). */}
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
      {/* Two copies, one control (§12.11's docs/table-requirements.md): a pointer keeps the
            dropdown it always had, touch gets two direct toggles instead — a trigger + panel inside
            `.toolbar-scroll` inherits its `overflow-y: auto` (a side effect of setting only
            `overflow-x`), which clipped the dropdown's panel invisibly on touch;
            `getBoundingClientRect()`-based specs never caught it because clipping doesn't move a
            box's own geometry. `pointer-only`/`touch-only` are the gate (app/globals.css) and say
            on the line which surface paints each span; `list-dropdown`/`list-buttons` stay as the
            shapes' own names, which §12.11 and the specs cite. `contents` on both, so either
            shape's own element(s) are flex items of this row directly. Both toggles refuse inside a
            code block (guarded-block-toggles.ts), where converting would shred it into prose —
            `ListMenu`'s trigger reads that from `editor.can()` too. */}
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
      {/* The insert group, rendered here for a pointer and inside the header's ＋ for touch
          (InsertMenu.tsx). Both copies are in the DOM at every width and `pointer-only` says which
          surface paints this one — the §12.4 idiom, for the reason stated there: a `matchMedia`
          read in React would render one way and correct itself, which is a hydration mismatch.

          `contents`, so on a pointer the four controls are flex items of the toolbar exactly as
          they were before this wrapper existed — the row wraps at the same widths. `toolbar-insert`
          is no longer the gate, only this copy's own name (the spec locates it by that). */}
      <InsertControls
        editor={editor}
        uploading={uploading}
        onImageChange={onImageChange}
        pickerTestId='image-picker'
        className='toolbar-insert pointer-only contents'
      />
      {/* Undo and redo, last in the row (§12.13). A same-day swap tried moving these to the page
            header and ＋ here instead — reverted a back arrow (記事一覧) beside an undo arrow read
            as confusable, so both stayed put (2026-09-18, see §12.13's own note). Drawn only
            under `hover: none` (app/globals.css), since a pointer has the keyboard route. They
            exist for touch: `Mod-z` is the only other route and a phone keyboard has no Ctrl —
            Android offers no undo gesture at all, and the iOS one (shake, three-finger swipe)
            reaches the editor as a `beforeinput` of `inputType: historyUndo`, which
            prosemirror-view handles (measured 2026-09-09: dispatching that event does undo, so iOS
            has a route and Android has none). `historyControl`, not `wide`: their icon is a bare
            `<svg>` rather than a span-wrapped glyph, so it needs `.toolbar-button-history`'s own
            manual flex centring (ToolbarButton.tsx) — `wide`'s targets already centre their own
            content. */}
      {/* A divider ahead of the pair (§12.17, 2026-09-18): history is a different kind of action
          from the format/list marks ahead of it, the same reasoning `.toolbar-mark-divider`
          already carries for the H2/H3 | B/I/S/A/強調 boundary — and the gap alone once measured a
          real miss here (`.toolbar-history`'s old `margin-right: 6px`, §12.4: a press aimed at the
          first mark and missed landed on redo). */}
      <span
        className='toolbar-mark-divider mx-0.5 w-px shrink-0 self-stretch bg-zinc-300 dark:bg-zinc-600'
        aria-hidden='true'
      />
      <ToolbarButton
        // Not `focusThenRun` (§12.21's fix on every other button here): `disabled` already keeps
        // this unreachable in the state that fix is for. Undo history is empty until *some*
        // transaction has landed, and every button that lands one now focuses first — so by the
        // time this is enabled, the editor has already had focus.
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title={SHORTCUT.undo.label}
        shortcut={SHORTCUT.undo.token}
        historyControl>
        <UndoIcon />
      </ToolbarButton>
      <ToolbarButton
        // Same reasoning as 元に戻す above — unreachable while unfocused, since `disabled` gates it
        // on redo history existing, which requires a prior undo, which requires prior focus.
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
  // `null` outside the drawer (the pointer toolbar), so `nav?.closeMenu()` below is a no-op there
  // — see insert-menu-nav.ts. 引用/脚注/画像 insert something and are done in one gesture, unlike
  // 囲み枠/表 (drill into a picker) and リンク (opens InsertDialog, which covers the sheet on its
  // own); closing the sheet is what shows the author what just happened, instead of leaving them
  // looking at a backdrop over their own edit.
  const nav = useInsertMenuNav();

  // Each row is built once and placed twice below, in a different order per surface — the pointer
  // toolbar keeps its original 囲み枠/引用/表/リンク/画像 order (unaffected by the drawer's own
  // reordering below), and the ＋ drawer runs
  // 画像/リンク/引用/囲み枠/表/アコーディオン/コードブロック/脚注 (コードブロック added
  // 2026-09-20, ahead of 脚注 on request, on the same "rare block" basis as 脚注/アコーディオン).
  // Building an element once and placing the *same* reference in whichever one of the two
  // branches below actually renders is fine — only one branch ever mounts it.

  // Image insert belongs in the toolbar too, but needs a file picker rather
  // than an editor command, so it's a <label>-wrapped hidden input styled to
  // match ToolbarButton. Paste and drag-and-drop also insert images.
  //
  // It keeps `cursor-pointer` of its own where the buttons beside it no longer
  // need one: app/globals.css's base rule reaches `button`, and a <label> is
  // not one — without this, the label's own text would hand back the I-beam.
  //
  // `toolbar-button` for the same reason, one rule further on: the touch-only ring
  // (table-requirements.md §12.2) is written against that class, and being the one control in
  // the row without a `<button>` under it left it as the one control in the row without an
  // outline — on the phone where the outline is what says "press here".
  const image = (
    <label
      key='image'
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
        onChange={(event) => {
          onImageChange(event);
          nav?.closeMenu();
        }}
      />
    </label>
  );

  // Same command and target position as the slash menu's 「リンク」 row (slash-command.ts): the
  // dialog itself decides link card vs. embed from the URL, so one entry point covers both.
  // `can()` mirrors that row's `available` guard — greyed out in a paragraph-only table cell,
  // where neither outcome could land.
  //
  // Icon-only on a pointer (2026-09-20, the same `labelled` ternary 引用 uses): worded, it sat
  // between 表 and 画像 — both worded themselves, for reasons of their own the toolbar isn't
  // reconsidering here — and read as one labelled button stranded between two others of the same
  // kind. Icon-only alone would have swapped which neighbour it read oddly next to, not fixed it,
  // so the pointer order below also moves it beside 囲み枠/引用, the toolbar's other two icon-only
  // controls.
  const link = (
    <ToolbarButton
      key='link'
      onClick={() => {
        // Captured ahead of `focusThenRun`, not inside its callback: that callback runs after
        // the raw DOM focus (and whatever nested transaction it settles), and this position is
        // meant to be where the caret already was, not wherever it ends up after that.
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

  // 引用 (§12.9): a pointer keeps it `compact` beside the toolbar's other icons; the ＋ panel's
  // rows are worded (labelled), the same asymmetry CalloutMenu's own trigger has and for the
  // same reason — no tooltip exists under `hover: none`.
  const quote = (
    <ToolbarButton
      key='quote'
      onClick={() => {
        focusThenRun(editor, (c) => c.toggleBlockquote());
        nav?.closeMenu();
      }}
      active={editor.isActive('blockquote')}
      // Refuses in a paragraph-only table cell (table-extensions.ts) with no command guard
      // needed there — toggleBlockquote already reports false rather than converting anything,
      // so `can()` is the whole fix. It stays enabled inside a code block on purpose — quoting
      // one wraps it, keeping the block. A NodeSelection over a linkCard/embed is a separate
      // case that does need a guard (blockquote-extension.ts), since wrapIn happily wraps a
      // selected atom instead of refusing.
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

  // Horizontal rule has no toolbar button: h2's red underline already carries the section-divider
  // role, so this is left to the `---` + Enter input rule (StarterKit default) for the rare case
  // someone wants an in-section break.

  // アコーディオン: drawer only (`labelled`) — docs/accordion-requirements.md §7 still declines a
  // *pointer* toolbar button (unlike 囲み枠, it has no type to pick, so the reasoning that put
  // callout there doesn't reach it, and the row would only cost the cramped toolbar a column). The
  // drawer isn't that row: it's a scrollable list, not a width-constrained strip, and 囲み枠/表
  // already sit there despite having their own slash-menu and input-rule routes too — an
  // occasionally-reached block earns a discoverable row there on that basis alone, not because
  // typing `:::details ` is hard (2026-09-20).
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

  // コードブロック: drawer only (`labelled`), not the pointer toolbar — it's a rare block, and the
  // ```lang typing rule / Mod-Alt-c shortcut / `/` slash row cover a keyboard author. The drawer
  // row exists for the same reason 脚注/アコーディオン got one despite already having a route of
  // their own: ``` and `/` both sit behind a phone keyboard's symbol layer. Inline code (`` ` ``,
  // Mod-e) stays out of both toolbar and drawer — its own three entry points are a decision this
  // row doesn't reopen.
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

  // 脚注: drawer only (`labelled`), not the pointer toolbar — docs/footnote-requirements.md §9
  // still declines a toolbar button there, on the inline-code precedent. The drawer is a narrower
  // carve-out: `[^` and Mod-Shift-F both need symbols a phone keyboard puts behind a shift layer,
  // which is the reason 囲み枠/表/リンク/画像 got a row here despite `:::info` etc. having their
  // own input rules too. `setFootnote` inserts a reference at the caret like the shortcut does —
  // it doesn't care that the call came from a menu rather than a keybinding — so this reuses the
  // same command Toolbar's own `Mod-Shift-f` calls, not a new one.
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
        ? [image, link, quote, callout, table, accordion, codeBlock, footnote]
        : [callout, quote, link, table, image]}
    </div>
  );
}
