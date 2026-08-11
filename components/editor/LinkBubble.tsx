'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { ToolbarButton } from './ToolbarButton';

// The editor's only link UI: a small floating card over the link the caret is in, holding the four
// things an author needs — see where it points, open it, edit the URL, remove the link. Pressing
// Mod-k over a selection opens the same card with an empty URL field, which is how a link is made.
//
// Why this exists at all (docs/link-requirements.md §5.5). Two holes met here:
//
//   - There was no way to make an internal link. Every automatic path (autolink, paste-over-
//     selection, the paste rules) runs the pasted text through linkifyjs, which only ever finds
//     URLs and mail addresses — a relative path or a `#heading` is not a link to it, so it just
//     replaced the selection with the text (§2.1.1). Typed `[text](url)` never worked either: the
//     markdown serializer escapes `[` and `]` unconditionally, so the syntax is saved as `\[text\]`
//     and the parser is never given the chance to read it back (§2.2.1). A URL field the author
//     types into is the whole fix — `#heading` and `/posts/foo` are accepted by the link
//     extension's own validator, which only subtracts the schemes publishing would drop.
//   - `openOnClick: false` (§3) took away "open this link" as the price of being able to put the
//     caret in one. The card gives it back, so that trade is settled rather than merely accepted.
//
// Caret-driven rather than hover-driven on purpose: hover- or focus-triggered content owes WCAG SC
// 1.4.13 dismissible/hoverable/persistent (the lesson recorded in popover-api-pitfalls), while an
// editing affordance that follows the caret does not. Escape still closes it.

// The plugin key this menu registers under. Named so the metas below reach this menu and not the
// table's — both are bubble menus on the same editor.
const MENU_KEY = 'linkMenu';
const OPEN_SHORTCUT = 'Mod-k';

// While the card is up, `body.link-menu-open` suppresses the table toolbar (app/globals.css): a link
// inside a table cell would otherwise raise two floating menus at once, and the link is the more
// specific target. CSS rather than a `shouldShow` term because the bubble menu plugin only
// re-evaluates shouldShow on a transaction that changes the selection or the document, and entering
// the URL field changes neither — the same reason the block drag suppresses it this way.
const SUPPRESS_TABLE_MENU = 'link-menu-open';

// The <a> the caret is in, to anchor the card to. Two positions are tried because a caret sitting at
// a link's right edge still reports the mark (it is inclusive — see below) while `domAtPos` there
// resolves to the paragraph, not into the anchor; `from - 1` is inside the link's text in that case.
// Anchoring to the element rather than the selection keeps the card still while the caret moves
// through the link, the same reason the table toolbar pins itself to a cell.
function linkElementAt(editor: Editor): HTMLAnchorElement | null {
  const { from } = editor.state.selection;
  for (const pos of [from - 1, from]) {
    if (pos < 0) continue;
    const { node } = editor.view.domAtPos(pos);
    const el = node instanceof Element ? node : node.parentElement;
    const anchor = el?.closest('a');
    if (anchor) return anchor;
  }
  return null;
}

function currentHref(editor: Editor): string {
  const href = editor.getAttributes('link').href;
  return typeof href === 'string' ? href : '';
}

export function LinkBubble({
  editor,
  onNotice,
}: {
  editor: Editor;
  onNotice: (message: string) => void;
}) {
  // `editing` drives the render; the ref is what shouldShow reads, because that callback has to keep
  // a stable identity (a new one each render dispatches a transaction, which re-renders us — the
  // "Maximum update depth" loop the table toolbar documents).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const editingRef = useRef(false);
  // Escape closes the card while the caret stays put; without this it would come straight back on
  // the next transaction. Cleared as soon as the caret leaves the link, so it never sticks.
  const dismissedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const href = currentHref(editor);

  const signal = useCallback(
    (meta: 'show' | 'hide') => {
      editor.view.dispatch(editor.state.tr.setMeta(MENU_KEY, meta));
    },
    [editor],
  );

  const openField = useCallback(
    (initial: string) => {
      setDraft(initial);
      editingRef.current = true;
      setEditing(true);
      // Nothing about opening the field changes the selection or the document, so the plugin would
      // not otherwise re-check: say it outright.
      signal('show');
    },
    [signal],
  );

  const close = useCallback(() => {
    editingRef.current = false;
    setEditing(false);
    editor.commands.focus();
    // Cancelling an assignment leaves no link under the caret, so the card has nothing left to show.
    if (!editor.isActive('link')) signal('hide');
  }, [editor, signal]);

  // The card is for a link the caret is inside, plus the moment the URL field is open (during an
  // assignment there is no link yet). `isActive` covers a caret at the link's right edge as well as
  // within it: the mark is inclusive because `inclusive()` in the link extension returns
  // `this.options.autolink`, which §4 decided to keep true. Were autolink ever turned off, this
  // would have to resolve the link's range by hand instead.
  const shouldShow = useCallback(() => {
    if (editingRef.current) return true;
    if (!editor.isActive('link')) {
      dismissedRef.current = false;
      return false;
    }
    return !dismissedRef.current;
  }, [editor]);

  const appendTo = useCallback(() => document.body, []);
  const getReferencedVirtualElement = useCallback(() => {
    const anchor = linkElementAt(editor);
    // Null falls back to the plugin's own selection rect, which is what an assignment (no link yet)
    // wants anyway.
    return anchor
      ? { getBoundingClientRect: () => anchor.getBoundingClientRect(), contextElement: anchor }
      : null;
  }, [editor]);

  const options = useMemo(
    () => ({
      // Below the link: above would cover the line being read, and a link is usually mid-sentence.
      placement: 'bottom-start' as const,
      offset: 8,
      flip: true,
      shift: true,
      onShow: () => document.body.classList.add(SUPPRESS_TABLE_MENU),
      onHide: () => document.body.classList.remove(SUPPRESS_TABLE_MENU),
      onDestroy: () => document.body.classList.remove(SUPPRESS_TABLE_MENU),
    }),
    [],
  );

  // Focus the URL field as it opens, with its contents selected so retyping a wrong URL is one
  // gesture. Focus leaving the editor does not hide the card: the plugin's blur handler ignores a
  // focus move into its own element.
  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  // Mod-k and Escape. The link extension ships no keymap of its own, and nothing else in this editor
  // claims Mod-k (measured). Registered on the editor's DOM node in the capture phase rather than as
  // an extension keymap so the whole feature stays in one file.
  //
  // preventDefault is what keeps the browser's own Ctrl+K (address bar) from firing, the same thing
  // Google Docs does. Confirmed by hand in a real browser on 2026-08-11; no headless test can tell
  // whether the browser yielded, so this cannot be pinned by a spec.
  useEffect(() => {
    const dom = editor.view.dom;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        if (editingRef.current) return;
        dismissedRef.current = false;
        if (editor.isActive('link')) {
          openField(currentHref(editor));
          return;
        }
        if (editor.state.selection.empty) {
          onNotice('リンクにするテキストを選択してください');
          return;
        }
        openField('');
        return;
      }
      if (event.key === 'Escape' && !editingRef.current && editor.isActive('link')) {
        if (dismissedRef.current) return;
        dismissedRef.current = true;
        signal('hide');
      }
    };
    dom.addEventListener('keydown', onKeyDown, { capture: true });
    return () => dom.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [editor, onNotice, openField, signal]);

  const applyDraft = useCallback(() => {
    const next = draft.trim();
    if (next === '') {
      // An emptied field means "this should not be a link" when there is one, and nothing at all
      // when the author was in the middle of making one.
      if (editor.isActive('link')) editor.chain().extendMarkRange('link').unsetLink().run();
      close();
      return;
    }
    // setLink runs the href through the extension's isAllowedUri, which PostEditor narrowed to the
    // schemes the public sanitizer will actually publish (editor/link-protocols.ts). A refused
    // scheme returns false and changes nothing, so the refusal is the whole of the feedback unless
    // it is said out loud.
    //
    // No `.focus()` in this chain: a chain dispatches the commands that did succeed even when a
    // later one refuses, so focus would jump back to the editor while the field is still open,
    // leaving the author looking at a URL they can no longer type into.
    const applied = editor.chain().extendMarkRange('link').setLink({ href: next }).run();
    if (!applied) {
      // Two unrelated refusals land here and they need different words. The scheme was refused
      // (`isAllowedUri`, above), or the *place* cannot hold a link mark at all: an accordion title
      // and a code block both declare `marks: ''`, and the inline `code` mark excludes every other
      // mark. `can().setMark` answers exactly the second question (TipTap's canSetMark tests both
      // the node's allowsMarkType and the marks already there), so ask it rather than guess.
      // Saying nothing is not an option — a refused command changes nothing, which is the silent
      // death §2.4 and §2.5 exist to prevent.
      onNotice(
        editor.can().setMark('link')
          ? 'このリンク先は公開できないため設定していません'
          : 'ここにはリンクを付けられません',
      );
      inputRef.current?.focus();
      return;
    }
    editingRef.current = false;
    setEditing(false);
    editor.commands.focus();
  }, [close, draft, editor, onNotice]);

  const copyHref = useCallback(() => {
    // navigator.clipboard exists only in a secure context. Production is HTTPS and dev is
    // localhost, which counts as one, but reaching the dev server by LAN IP would not — and an
    // undefined `clipboard` there would throw inside an event handler rather than say anything.
    if (!navigator.clipboard) {
      onNotice('コピーできませんでした');
      return;
    }
    navigator.clipboard.writeText(href).then(
      () => onNotice('リンク先をコピーしました'),
      () => onNotice('コピーできませんでした'),
    );
  }, [href, onNotice]);

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={MENU_KEY}
      // 250ms by default, which would leave the card at the previous link while the caret has
      // already moved to another one. Nothing here needs the debounce the table toolbar's own
      // comment describes, and the card follows a caret rather than a drag.
      updateDelay={0}
      shouldShow={shouldShow}
      appendTo={appendTo}
      options={options}
      getReferencedVirtualElement={getReferencedVirtualElement}
      // `group`, not `toolbar`: a toolbar role promises arrow-key navigation between its controls
      // (roving tabindex), which this card does not implement — four Tab stops is the right size
      // for it. `group` carries the label without promising a keyboard model it does not have.
      role='group'
      aria-label='リンク'
      // Escape pressed with focus on one of these buttons. The editor's own listener above cannot
      // see it (focus is in <body>, not the editor's DOM), and the URL field handles its own.
      //
      // Read the key off `nativeEvent`. The event this menu hands its prop callbacks is
      // `Object.create(realEvent)` (@tiptap/react's useMenuElementProps), so every native accessor
      // reached through the prototype — `.key` among them — is invoked with a `this` that is not a
      // real KeyboardEvent and throws "Illegal invocation". It threw on every keystroke inside the
      // card, and a throw inside a DOM handler shows up as nothing happening; `page.on('pageerror')`
      // in the spec run is what surfaced it.
      onKeyDown={(event) => {
        if (event.nativeEvent.key !== 'Escape' || editingRef.current) return;
        dismissedRef.current = true;
        editor.commands.focus();
        signal('hide');
      }}
      className='link-bubble z-20 flex items-center gap-1 rounded border border-zinc-300 bg-white px-1.5 py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900'>
      {editing ? (
        // Deliberately not a <form>: PostEditor wraps the whole page in one, and a nested form is
        // dropped by the browser, so its submit silently does nothing (the shape TableGridMenu
        // documents). Enter and the button call the same function instead.
        <>
          <input
            ref={inputRef}
            // Not type='url': a fragment (#見出し) or a site-relative path (/posts/foo) is exactly
            // what this field exists to accept, and neither is a URL by that input's rules.
            type='text'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyDraft();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
            aria-label='リンク先'
            placeholder='https://… / /posts/… / #見出し'
            spellCheck={false}
            autoComplete='off'
            className='w-64 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'
          />
          <ToolbarButton onClick={applyDraft}>保存</ToolbarButton>
          <ToolbarButton onClick={close}>やめる</ToolbarButton>
        </>
      ) : (
        <>
          {/* The href in full view is half the point of the card: with openOnClick off, the browser's
              hover status bar was the only way to see where a link went. */}
          <span
            className='max-w-64 truncate px-1 text-xs text-zinc-600 dark:text-zinc-400'
            title={href}>
            {href}
          </span>
          <span
            className='mx-0.5 w-px self-stretch bg-zinc-400 dark:bg-zinc-600'
            aria-hidden='true'
          />
          <ToolbarButton
            onClick={() => {
              // noopener/noreferrer by hand: this is the editor's own DOM, not the published page,
              // so the anchor's rel attributes are not involved.
              window.open(href, '_blank', 'noopener,noreferrer');
            }}>
            開く
          </ToolbarButton>
          <ToolbarButton onClick={copyHref}>コピー</ToolbarButton>
          <ToolbarButton shortcut={OPEN_SHORTCUT} onClick={() => openField(href)}>
            編集
          </ToolbarButton>
          <ToolbarButton
            destructive
            onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}>
            解除
          </ToolbarButton>
        </>
      )}
    </BubbleMenu>
  );
}
