'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { BubbleMenu } from '@tiptap/react/menus';
import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';
import { setLinkHighlight } from './link-highlight-extension';
import { displayHref, editableLinkText, faviconSrc, linkAtCaret } from './link-at-caret';
import {
  collectHeadings,
  headingForFragment,
  matchHeadings,
  type DocumentHeading,
} from './document-headings';
import { EditorTooltip } from './EditorTooltip';
import { ToolbarButton } from './ToolbarButton';
import { CopyIcon } from './svg/CopyIcon';
import { PencilIcon } from './svg/PencilIcon';
import { UnlinkIcon } from './svg/UnlinkIcon';
import { CardIcon } from './svg/CardIcon';
import { IconSvg } from './svg/IconSvg';
import { canImportGithubBlob, importGithubBlob } from './github-blob-import';
import { embedMarkShapes, GITHUB_MARK_SHAPES } from './svg/icon-shapes';
import { isOwnPostHref, normalizeCardHref } from '@/lib/link-card-href';
import { resolveEmbed } from '@/lib/embed-provider';
import { parseGithubBlob } from '@/lib/github-blob';
import { isSpeakerdeckDeckPage } from '@/lib/speakerdeck-snippet';

// The editor's only link UI: a small floating card over the link the caret is in, holding the four
// things an author needs — see where it points, open it, edit the URL, remove the link. Pressing
// Mod-k over a selection opens the same card with an empty URL field, which is how a link is made.
//
// Why (docs/link-requirements.md §5.5): internal links (relative paths, `#heading`) had no way in,
// since every automatic path runs through linkifyjs, and `openOnClick: false` (§3) took away
// opening a link. A URL field and an open button settle both.
//
// Caret-driven, not hover-driven: hover content owes WCAG SC 1.4.13 (docs/editor-pitfalls.md
// §17.1); a caret-following affordance does not. Escape still closes it.

// Distinct from the table menu's key, so the metas below reach this menu.
const MENU_KEY = 'linkMenu';
const OPEN_SHORTCUT = 'Mod-k';

// While the card is up, this body class hides the table toolbar (app/globals.css), since a link in a
// cell would raise both. CSS, because `shouldShow` isn't re-asked when the URL field takes focus
// (docs/editor-pitfalls.md §10.4).
const SUPPRESS_TABLE_MENU = 'link-menu-open';

// Shared by both fields, which must line up. **The field fills its grid column and does not set
// the card's width** (§5.5.19): a definite width here overflowed the capped card on a phone.
const FIELD_CLASS =
  'w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus:border-[#0969da] focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-[#4493f8]';

// Each field's name, as a label rather than a placeholder (a filled field shows none). To the left,
// because height is the card's expensive axis: every added line covers another paragraph.
// `whitespace-nowrap`: in the capped `auto` column the label wrapped one character per line.
const LABEL_CLASS = 'shrink-0 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400';

// The heading list's wanted height (~6 rows; `size` caps it to the space available) and its gap,
// the card's own `offset: 8`.
const LIST_MAX_HEIGHT_PX = 192;
const LIST_GAP_PX = 8;
// The list's margin to the screen edge, as the card leaves (§5.5.19).
const LIST_EDGE_PX = 8;

// The <a> to anchor the card to. At a link's right edge `domAtPos` resolves to the paragraph, so
// `from - 1` is tried too. Anchoring to the element keeps the card still as the caret moves.
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

// Drawn only once loaded, since failure is common and an empty box reads as broken; the card is
// left-anchored, so its arrival grows it rightwards. `no-referrer`, so the third party doesn't learn
// which page is being edited. Keyed on href by the caller, so a new link remounts it.
function LinkFavicon({ href }: { href: string }) {
  const src = faviconSrc(href, window.location.origin);
  const [loaded, setLoaded] = useState(false);
  if (!src) return null;
  return (
    // A plain <img>: next/image would need every linkable origin configured.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=''
      aria-hidden='true'
      width={16}
      height={16}
      referrerPolicy='no-referrer'
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(false)}
      className={`${loaded ? 'block' : 'hidden'} ml-1 h-4 w-4 shrink-0 rounded-sm`}
    />
  );
}

export function LinkBubble({
  editor,
  onNotice,
  ownSlug,
}: {
  editor: Editor;
  onNotice: (message: string) => void;
  // The post being edited, so a link to it isn't offered 「カードにする」 (§18).
  ownSlug: string;
}) {
  // `editing` drives the render; shouldShow reads the ref, since it must keep a stable identity.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Whether the plugin has the card on screen, known only from `onShow`/`onHide`. State, so the
  // highlight effect re-runs on a blur, which makes no transaction.
  const [menuVisible, setMenuVisible] = useState(false);
  // The fetched title, paired with its href so it never shows under another link's URL.
  const [fetchedTitle, setFetchedTitle] = useState<{ href: string; title: string } | null>(null);
  // The text being edited and its initial value; `textInitial` is null when there is no text field
  // (§5.5.13), and comparing against it keeps an untouched field from costing a replacement.
  const [textDraft, setTextDraft] = useState('');
  const [textInitial, setTextInitial] = useState<string | null>(null);
  // The heading picker (§5.5.17). `suggestDismissed` closes the list after a pick or Escape while
  // the value still starts with `#`; typing reopens it.
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const editingRef = useRef(false);
  // Escape closes the card while the caret stays put; without this it would come straight back on
  // the next transaction. Cleared as soon as the caret leaves the link, so it never sticks.
  const dismissedRef = useRef(false);
  // The link the press below has decided the card is leaving. `signal('hide')` is synchronous but
  // the caret hasn't moved, so a transaction in between would re-show the card for a frame (§5.5.15;
  // seen as a shard-only failure of e2e/editor-link-bubble.spec.ts). A range, not `dismissedRef`,
  // because it concerns this one link: a caret landing in another still gets its card.
  const leavingRef = useRef<{ from: number; to: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The card element itself, so its size can be watched (see the ResizeObserver below).
  const cardRef = useRef<HTMLDivElement | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Joins each label to its input.
  const fieldId = useId();

  const href = linkAtCaret(editor.state)?.href ?? '';
  const title = fetchedTitle?.href === href ? fetchedTitle.title : null;

  // Turning this link into a card (docs/link-card-requirements.md §14.6-2), decided here because a
  // present button that does nothing is worse than none (§5.2-1). `normalizeCardHref` says whether
  // there is a card to become (rewriting this blog's own URLs, §14.5.1); `can()` says whether the
  // link is the whole line.
  const link = linkAtCaret(editor.state);
  // The order is the decision (docs/embed-requirements.md §5): a provider is asked first, so a
  // YouTube link is never offered a card.
  const embedTarget = link ? resolveEmbed(link.href) : null;
  const embedHref = link && embedTarget ? link.href : null;
  const toEmbed =
    link && embedHref && editor.can().linkToEmbed({ from: link.from, to: link.to }, embedHref)
      ? () => editor.chain().focus().linkToEmbed({ from: link.from, to: link.to }, embedHref).run()
      : null;
  // §16.10: a Speaker Deck deck page carries no id, so only a card is offered; a line says where
  // the embed code is, as saying so needs no fetch (§3.2, §15.6).
  const deckPageHint = link ? isSpeakerdeckDeckPage(link.href) : false;
  // A GitHub blob URL becomes a code block (§19.2), asked after `resolveEmbed` and before the
  // card. **The only asynchronous button:** it can fail after the press, reported through
  // `BLOB_NOTICES` and the toast.
  const blobHref = link && !embedHref && parseGithubBlob(link.href) ? link.href : null;
  const toBlob =
    link && blobHref && canImportGithubBlob(editor.state, { from: link.from, to: link.to })
      ? () => {
          void importGithubBlob(editor, { from: link.from, to: link.to }, blobHref).then(
            (notice) => {
              if (notice) onNotice(notice);
            },
          );
        }
      : null;
  const cardHref =
    link && !embedHref && !blobHref ? normalizeCardHref(link.href, window.location.origin) : null;
  // A link to the post being written can't become a card (§18); the button disappears, the link
  // stays.
  const selfCard = cardHref !== null && isOwnPostHref(cardHref, ownSlug);
  const toCard =
    link &&
    cardHref &&
    !selfCard &&
    editor.can().linkToCard({ from: link.from, to: link.to }, cardHref)
      ? () => editor.chain().focus().linkToCard({ from: link.from, to: link.to }, cardHref).run()
      : null;

  const signal = useCallback(
    (meta: 'show' | 'hide' | 'updatePosition') => {
      editor.view.dispatch(editor.state.tr.setMeta(MENU_KEY, meta));
    },
    [editor],
  );

  // Has the author left the card? Blur and focus-leaving both ask this one question (§5.5.9). The
  // portalled card counts as a place to be, or pressing its buttons hid it before the click landed.
  // `hasFocus()` rather than `view.dom.contains(active)`, so focus on a NodeView control (the link
  // card's 変更) counts as leaving.
  const focusLeft = useCallback(() => {
    const active = document.activeElement;
    if (active?.closest('.link-bubble')) return false;
    return !editor.view.hasFocus();
  }, [editor]);

  // Open the edit mode, seeding the text field with the text as it is now, which a save compares
  // against.
  const openField = useCallback(() => {
    const link = linkAtCaret(editor.state);
    setDraft(link?.href ?? '');
    // No text field while making a link: the selected text already is the text (§5.5.13).
    const text = link ? editableLinkText(editor.state.doc, link.from, link.to) : null;
    setTextInitial(text);
    setTextDraft(text ?? '');
    // An existing `#…` link opens with its list showing, which is the same offer as typing the `#`.
    setSuggestDismissed(false);
    setSuggestIndex(0);
    editingRef.current = true;
    setEditing(true);
    // Opening changes neither selection nor document, so tell the plugin.
    signal('show');
  }, [editor, signal]);

  // Leave the field without applying, and without touching focus (the dismissing click places the
  // caret).
  const abandonField = useCallback(() => {
    editingRef.current = false;
    setEditing(false);
    // Cancelling an assignment leaves no link under the caret, so the card has nothing left to show.
    if (!linkAtCaret(editor.state)) {
      signal('hide');
      return;
    }
    // Back to display mode only if the author is still in the editor, checked a frame later since
    // leaving the field for a third place fires no blur (and 適用 refocuses the editor first).
    requestAnimationFrame(() => {
      if (editingRef.current || !focusLeft()) return;
      dismissedRef.current = true;
      signal('hide');
    });
  }, [editor, focusLeft, signal]);

  const close = useCallback(() => {
    abandonField();
    editor.commands.focus();
  }, [abandonField, editor]);

  // Shown for a link the caret is in or at the right edge of (linkAtCaret), and while the field is
  // open.
  const shouldShow = useCallback(() => {
    if (editingRef.current) return true;
    const link = linkAtCaret(editor.state);
    if (!link) {
      dismissedRef.current = false;
      leavingRef.current = null;
      return false;
    }
    // Still the link the press said we were leaving, which means the caret's own transaction has
    // not arrived yet. Answering "show" here is what repaints the card over it for a frame.
    const leaving = leavingRef.current;
    if (leaving && leaving.from === link.from && leaving.to === link.to) return false;
    // A different link: the decision was not about this one, so it stops applying.
    leavingRef.current = null;
    return !dismissedRef.current;
  }, [editor]);

  // Tint the link while the card is up (§5.5.7), recomputed each render; `setLinkHighlight` no-ops
  // when unchanged, so this can't loop. Gated on `menuVisible`, not `shouldShow`: a blur hides the
  // card without re-asking `shouldShow`, and the tint was left behind.
  useEffect(() => {
    if (!menuVisible || !shouldShow()) {
      setLinkHighlight(editor, null);
      // Shown while its predicate refuses: IME. `updateHandler` returns early on
      // `const { composing } = view;`, and nothing re-asks later, so typing at a link's right edge
      // left the card up (§5.5.14).
      if (menuVisible) signal('hide');
      return;
    }
    const link = linkAtCaret(editor.state);
    if (link) {
      setLinkHighlight(editor, { from: link.from, to: link.to });
      return;
    }
    // `Mod-k` over a selection: no link exists yet, so light the text that is about to become one.
    const { from, to } = editor.state.selection;
    setLinkHighlight(editor, editingRef.current && from < to ? { from, to } : null);
  });

  // Clicking elsewhere closes the field, as Docs does; otherwise it re-anchored to the new caret.
  // `mousedown`, before the selection moves. A `closest()` test, since the card is portalled.
  //
  // A press inside the editable area also hides the card synchronously: it is about to move the
  // caret off this link, and waiting for that transaction left the display card over the old link
  // for a few frames. The plugin re-shows it if the caret lands in another link. Presses outside
  // (the toolbar, which refocuses the editor) keep the deferred rule in `abandonField` (§5.5.9).
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.link-bubble')) return;
      const anchor = linkElementAt(editor);
      const staying = target instanceof Node && anchor?.contains(target);
      const inDocument = target instanceof Node && editor.view.dom.contains(target);
      abandonField();
      if (inDocument && !staying) {
        // Captured before the caret moves — after it, there is nothing left to name.
        leavingRef.current = linkAtCaret(editor.state);
        signal('hide');
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [abandonField, editing, editor, signal]);

  // The same departure by keyboard: tabbing past the card's last button leaves focus on <body>.
  // Deferred a frame and read from `document.activeElement`, since opening the field (unmounting
  // 編集) looks identical to tabbing away until focus has moved into the field. Also in display mode:
  // with focus on a card button the editor is already blurred, so leaving fires no blur (§5.5.9).
  useEffect(() => {
    if (!editing && !menuVisible) return;
    const onFocusOut = () => {
      requestAnimationFrame(() => {
        if (!focusLeft()) return;
        abandonField();
      });
    };
    document.addEventListener('focusout', onFocusOut);
    return () => document.removeEventListener('focusout', onFocusOut);
  }, [abandonField, editing, focusLeft, menuVisible]);

  // The display card follows the editor's focus (§5.5.9): buttons that dispatch nothing (the form,
  // the link card's 変更) left it up. Deferred a frame and settled by `focusLeft()`, because a
  // toolbar button emits blur *and* focus; hiding on the raw blur lost the card to 太字. Focus on the
  // card itself is not leaving. `dismissedRef`, since 変更's picker dispatches transactions that would
  // re-show it; returning focus clears it, unlike Escape's dismissal.
  useEffect(() => {
    const onBlur = () => {
      requestAnimationFrame(() => {
        if (editingRef.current || !focusLeft()) return;
        dismissedRef.current = true;
        signal('hide');
      });
    };
    const onFocus = () => {
      dismissedRef.current = false;
    };
    editor.on('blur', onBlur);
    editor.on('focus', onFocus);
    return () => {
      editor.off('blur', onBlur);
      editor.off('focus', onFocus);
    };
  }, [editor, focusLeft, signal]);

  const appendTo = useCallback(() => document.body, []);
  const getReferencedVirtualElement = useCallback(() => {
    // While making a link, anchor to the selection: `linkElementAt`'s `from - 1` found the link
    // just before a selection (§5.5.11).
    if (editingRef.current && !linkAtCaret(editor.state)) return null;
    const anchor = linkElementAt(editor);
    // Null falls back to the plugin's own selection rect.
    return anchor
      ? { getBoundingClientRect: () => anchor.getBoundingClientRect(), contextElement: anchor }
      : null;
  }, [editor]);

  const options = useMemo(
    () => ({
      // Above the link, covering paragraphs already read rather than the next ones (§5.5.10).
      // `flip`'s boundary is the editor element, not the viewport, so a first-line link flips below
      // instead of hiding under the sticky toolbar.
      placement: 'top-start' as const,
      offset: 8,
      flip: { boundary: editor.view.dom },
      // `padding`, or `shift` accepts a right edge exactly at the viewport's, which is off screen
      // wherever a device disagrees with `100vw`.
      shift: { padding: 8 },
      // The only report of whether the card is on screen: the table-toolbar class and
      // `setMenuVisible`. Called from the plugin's view update, so setting state is safe.
      onShow: () => {
        document.body.classList.add(SUPPRESS_TABLE_MENU);
        setMenuVisible(true);
      },
      onHide: () => {
        document.body.classList.remove(SUPPRESS_TABLE_MENU);
        setMenuVisible(false);
      },
      onDestroy: () => {
        document.body.classList.remove(SUPPRESS_TABLE_MENU);
        setMenuVisible(false);
      },
    }),
    // `editor` never changes, so the options stay stable.
    [editor],
  );

  // Re-place the card whenever it changes shape (§5.5.11): the plugin runs `updatePosition()` before
  // `show()`, and `updatePosition` returns early while hidden (`if (!this.isVisible) {`), so Mod-k
  // showed the card at the last link visited, or at the document's top-left. A layout effect, so the
  // correction lands before paint. The closing edge is kept for the rule, though refocusing already
  // re-places it today.
  useLayoutEffect(() => {
    if (!menuVisible) return;
    signal('updatePosition');
  }, [editing, menuVisible, signal]);

  // **And whenever the card's box changes, whatever changed it.** The plugin places the card before
  // React re-renders it for the new link, and `shift` doesn't run again, so a card that grew a
  // button ran 1px off a phone. A ResizeObserver also covers the title, favicon and embed button;
  // repositioning doesn't change the box, so it can't loop.
  useEffect(() => {
    const card = cardRef.current;
    if (!card || !menuVisible) return;
    const observer = new ResizeObserver(() => signal('updatePosition'));
    observer.observe(card);
    return () => observer.disconnect();
  }, [menuVisible, signal]);

  // Focus the URL field on open, contents selected. The plugin's blur handler ignores focus moving
  // into its own element.
  useEffect(() => {
    if (!editing) return;
    // `preventScroll`: the card may still be at the document's top-left for a microtask, and focusing
    // it there scrolled the page (§5.5.11).
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [editing]);

  // Mod-k and Escape, on the editor DOM in the capture phase (the link extension has no keymap).
  // preventDefault stops the browser's own Ctrl+K, as Docs does; checked by hand, since no headless
  // test can tell.
  useEffect(() => {
    const dom = editor.view.dom;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        if (editingRef.current) return;
        dismissedRef.current = false;
        if (!linkAtCaret(editor.state) && editor.state.selection.empty) {
          onNotice('リンクにするテキストを選択してください');
          return;
        }
        openField();
        return;
      }
      if (event.key === 'Escape' && !editingRef.current && linkAtCaret(editor.state)) {
        if (dismissedRef.current) return;
        dismissedRef.current = true;
        signal('hide');
      }
    };
    dom.addEventListener('keydown', onKeyDown, { capture: true });
    return () => dom.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [editor, onNotice, openField, signal]);

  // The target page's title, once per href while the card is up (§5.5.10). Often absent (e.g. a
  // Cloudflare 403), and the card reads fine without it. Aborted when the href changes. http(s) only.
  useEffect(() => {
    if (!menuVisible || editing) return;
    // A fragment resolves to an https URL for the site root and would pass the protocol test.
    if (href.startsWith('#')) return;
    let absolute: URL;
    try {
      absolute = new URL(href, window.location.origin);
    } catch {
      return;
    }
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return;
    const controller = new AbortController();
    fetch(`/api/link-title?url=${encodeURIComponent(absolute.toString())}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : { title: null }))
      .then((data: { title?: unknown }) => {
        if (typeof data.title === 'string') setFetchedTitle({ href, title: data.title });
      })
      // Including AbortError: no title is the resting state.
      .catch(() => {});
    return () => controller.abort();
  }, [editing, href, menuVisible]);

  const applyDraft = useCallback(() => {
    const next = draft.trim();
    if (next === '') {
      // An emptied field means "this should not be a link" when there is one, and nothing at all
      // when the author was in the middle of making one.
      if (linkAtCaret(editor.state)) editor.chain().extendMarkRange('link').unsetLink().run();
      // Not `close()`, whose focus scrolled the page on a phone (§5.5.21); `abandonField` takes its
      // synchronous branch here, the link having just been removed.
      abandonField();
      editor.view.focus();
      return;
    }
    // An empty text is refused, not a removal: emptying the URL already removes (§5.5.13).
    if (textInitial !== null && textDraft.trim() === '') {
      onNotice('リンクのテキストは空にできません');
      textInputRef.current?.focus();
      return;
    }
    // Asked first: **a chain dispatches the commands that succeeded even when a later one refuses**,
    // so a refused href would leave the text rewritten. `can().setLink` checks `isAllowedUri`
    // (link-protocols.ts) and `canSetMark`.
    if (!editor.can().setLink({ href: next })) {
      // A refused scheme, or a place that holds no link mark (accordion title, code block, inside
      // inline `code`), told apart with `can().setMark`. Silence is not an option (§2.4, §2.5).
      onNotice(
        editor.can().setMark('link')
          ? 'このリンク先は公開できないため設定していません'
          : 'ここにはリンクを付けられません',
      );
      inputRef.current?.focus();
      return;
    }
    // One chain, one undo. No `.focus()`, which would leave the open field if something refused.
    const link = linkAtCaret(editor.state);
    const chain = editor.chain();
    if (link && textInitial !== null && textDraft !== textInitial) {
      chain.command(({ tr }) => {
        // The whole mark set, so `title` (§5.3-3) and uniform emphasis survive; `setLink` merges the
        // new href in.
        const marks = tr.doc.nodeAt(link.from)?.marks;
        if (!marks?.some((m) => m.type === editor.schema.marks.link)) return false;
        tr.replaceWith(link.from, link.to, editor.schema.text(textDraft, marks));
        // Select the new text for `setLink`, which also keeps the card on it.
        tr.setSelection(TextSelection.create(tr.doc, link.from, link.from + textDraft.length));
        return true;
      });
    } else {
      chain.extendMarkRange('link');
    }
    if (!chain.setLink({ href: next }).run()) {
      onNotice('リンクを変更できませんでした');
      inputRef.current?.focus();
      return;
    }
    editingRef.current = false;
    setEditing(false);
    // `view.focus()`, not `editor.commands.focus()`: on a phone the command focuses without
    // `preventScroll` (`isiOS() || isAndroid()`) and then scrolls, and 適用 moved the page off the
    // author's line (§5.5.21). It is also synchronous, so the field's unmount `focusout` finds focus
    // back and the card stays (§5.5.9).
    editor.view.focus();
  }, [abandonField, draft, editor, onNotice, textDraft, textInitial]);

  // Enter saves and Escape cancels from either field; no nested <form> (docs/editor-pitfalls.md
  // §15.1). `hrefKeys` takes these keys while the heading list is up.
  const fieldKeys = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyDraft();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    },
    [applyDraft, close],
  );

  // The heading picker's contents, or null (§5.5.17). Only a `#` in *first* position triggers it,
  // not a URL carrying a fragment. The document can't change while the field has focus.
  const suggestions = useMemo(() => {
    if (!editing || suggestDismissed || !draft.startsWith('#')) return null;
    const headings = collectHeadings(editor.state.doc);
    return { headings, matches: matchHeadings(headings, draft.slice(1)) };
  }, [draft, editing, editor, suggestDismissed]);

  // Where the list goes (§5.5.17): below the card, above it when that fits better, or cut down on
  // the roomier side. Referenced to the **card**, never overlapping it; the `crossAxis` offset
  // keeps it under the field. `flip` before `size`, or size would shrink it first and flip would
  // never fire. The boundary is the editor element, as for the card. `shift` too (§5.5.19): the
  // capped card's list ran off a phone and widened the page.
  useLayoutEffect(() => {
    const list = listRef.current;
    const field = inputRef.current;
    const card = list?.closest('.link-bubble');
    if (!suggestions || !list || !field || !(card instanceof HTMLElement)) return;
    return autoUpdate(card, list, () => {
      void computePosition(card, list, {
        placement: 'bottom-start',
        middleware: [
          offset(() => ({
            mainAxis: LIST_GAP_PX,
            crossAxis: field.getBoundingClientRect().left - card.getBoundingClientRect().left,
          })),
          flip({ boundary: editor.view.dom, fallbackStrategy: 'bestFit' }),
          shift({ padding: LIST_EDGE_PX }),
          size({
            boundary: editor.view.dom,
            apply({ availableHeight, elements }) {
              elements.floating.style.maxHeight = `${Math.max(
                0,
                Math.min(LIST_MAX_HEIGHT_PX, availableHeight - LIST_GAP_PX),
              )}px`;
            },
          }),
        ],
      }).then(({ x, y }) => {
        list.style.left = `${x}px`;
        list.style.top = `${y}px`;
      });
    });
  }, [editor, suggestions]);

  // Writes the slug for the heading the author picked (see document-headings.ts).
  const chooseHeading = useCallback(
    (headingChoice: DocumentHeading) => {
      setDraft(`#${headingChoice.slug}`);
      setSuggestDismissed(true);
      // Only into an empty text field, and only where there is one: a link being made from a
      // selection has its text already, and an existing link's text is the author's to keep.
      if (textInitial !== null && textDraft.trim() === '') setTextDraft(headingChoice.text);
      inputRef.current?.focus();
    },
    [textDraft, textInitial],
  );

  // The URL field's keys: while the list is up it takes the list keys. Its Escape closes only the
  // list, since the card's Escape (which returns early while editing) would lose the edit
  // (§5.5.13).
  const hrefKeys = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      const matches = suggestions?.matches ?? [];
      if (suggestions) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setSuggestDismissed(true);
          return;
        }
        if (matches.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSuggestIndex((index) => (index + 1) % matches.length);
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSuggestIndex((index) => (index + matches.length - 1) % matches.length);
            return;
          }
          // Enter takes the highlighted row unless the field already holds exactly that fragment,
          // or no heading matches; then it means 適用.
          if (
            event.key === 'Enter' &&
            matches[suggestIndex] &&
            draft !== `#${matches[suggestIndex].slug}`
          ) {
            event.preventDefault();
            chooseHeading(matches[suggestIndex]);
            return;
          }
        }
      }
      fieldKeys(event);
    },
    [chooseHeading, draft, fieldKeys, suggestIndex, suggestions],
  );

  // For a fragment, the top line goes to the heading instead of opening (§5.5.18):
  // `window.open('#導入')` opened a second editor. It is also where a stale fragment is noticed.
  const jump = useCallback(() => {
    const heading = headingForFragment(collectHeadings(editor.state.doc), href);
    if (!heading) {
      onNotice('この文書にその見出しはありません');
      return;
    }
    // A heading inside a folded accordion can't take the caret usefully; asked of the rendered
    // element, and nothing is unfolded (§5.5.18).
    const dom = editor.view.nodeDOM(heading.pos);
    if (dom instanceof HTMLElement && dom.offsetParent === null) {
      onNotice('折りたたまれた中にあるため移動できません');
      return;
    }
    // `pos + 1` is inside the heading; the caret leaving the link hides the card.
    editor
      .chain()
      .focus()
      .setTextSelection(heading.pos + 1)
      .scrollIntoView()
      .run();
    // Centre it: the transaction's scroll leaves it under the sticky toolbar
    // (docs/editor-pitfalls.md §13.4).
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'center' });
  }, [editor, href, onNotice]);

  const isFragment = href.startsWith('#');

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
      ref={cardRef}
      editor={editor}
      pluginKey={MENU_KEY}
      // No debounce, or the card lags the caret by 250ms.
      updateDelay={0}
      shouldShow={shouldShow}
      appendTo={appendTo}
      options={options}
      getReferencedVirtualElement={getReferencedVirtualElement}
      // `group`, not `toolbar`, which would promise arrow-key navigation.
      role='group'
      aria-label='リンク'
      // Escape with focus on a card button, which the editor's listener can't see. Read the key off
      // `nativeEvent`: the prop callbacks get `Object.create(realEvent)`, whose native accessors throw
      // "Illegal invocation" (docs/editor-pitfalls.md §10.1).
      onKeyDown={(event) => {
        if (event.nativeEvent.key !== 'Escape' || editingRef.current) return;
        dismissedRef.current = true;
        editor.commands.focus();
        signal('hide');
      }}
      // Docs' card shape; the border stays for dark mode. `max-w` (§5.5.19) lets the fields shrink,
      // since `shift` can only move a card that fits; `2rem` leaves 8px each side, where `1rem` put
      // the right edge exactly at `100vw`.
      className='link-bubble z-20 flex max-w-[calc(100vw-2rem)] items-center gap-0.5 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.18)] dark:border-zinc-700 dark:bg-zinc-800'>
      {editing ? (
        // Not a <form> (docs/editor-pitfalls.md §15.1); Enter and 適用 call the same function. The text
        // field comes first, as in Docs, and is absent when not offered (§5.5.13).
        //
        // A grid, so both fields start where the wider label ends, with real `<label for>`s as their
        // accessible names. `w-96` is the edit width and `max-w-full` gives it up under the card's
        // cap; `min-w-0` lets this flex item go below its min-content (§5.5.19).
        <div className='grid w-96 min-w-0 max-w-full grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1'>
          {textInitial !== null && (
            <>
              <label htmlFor={`${fieldId}-text`} className={LABEL_CLASS}>
                テキスト
              </label>
              <input
                ref={textInputRef}
                id={`${fieldId}-text`}
                type='text'
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                onKeyDown={fieldKeys}
                spellCheck={false}
                autoComplete='off'
                className={FIELD_CLASS}
              />
            </>
          )}
          <label htmlFor={`${fieldId}-href`} className={LABEL_CLASS}>
            リンク先
          </label>
          {/* 8px between the field and 適用, matching the grid's label gap so the field has equal
                        air both sides. */}
          <div className='flex min-w-0 items-center gap-2'>
            {/* `relative`, so the heading list hangs outside the card: pushing 適用 down would move it
                            from under an approaching pointer. */}
            <div className='relative min-w-0 flex-1'>
              <input
                ref={inputRef}
                id={`${fieldId}-href`}
                // Not type='url': a fragment (#見出し) or a site-relative path (/posts/foo) is
                // exactly what this field exists to accept, and neither is a URL by that input's
                // rules.
                type='text'
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  // Typing is what re-opens a dismissed list — including the keystroke right after
                  // a heading was chosen, which is the author correcting the choice.
                  setSuggestDismissed(false);
                  // The query changed, so the highlight returns to the top.
                  setSuggestIndex(0);
                }}
                onKeyDown={hrefKeys}
                // **No placeholder:** the forms it once taught are learned from the `[]()` rule
                // (§5.4), the label gives the name, and typing `#` announces the heading picker.
                spellCheck={false}
                autoComplete='off'
                // `aria-activedescendant` announces the current row. Not `role='combobox'`, which would
                // sit on this URL box permanently; the cost is that the list's appearance isn't
                // announced.
                aria-controls={suggestions ? `${fieldId}-headings` : undefined}
                aria-activedescendant={
                  suggestions?.matches[suggestIndex]
                    ? `${fieldId}-heading-${suggestIndex}`
                    : undefined
                }
                className={FIELD_CLASS}
              />
              {suggestions && (
                <div
                  ref={listRef}
                  id={`${fieldId}-headings`}
                  role='listbox'
                  aria-label='見出しの候補'
                  // Styled like the `/` menu. Position and max height come from the layout effect
                  // above, before paint; `max-w` caps the width on a phone (§5.5.19).
                  className='absolute z-10 flex w-72 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded border border-zinc-300 bg-white py-0.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900'>
                  {suggestions.matches.length === 0 ? (
                    // No headings, or none matching: the author acts differently on each.
                    <p className='px-2 py-1.5 text-xs text-zinc-500 dark:text-zinc-400'>
                      {suggestions.headings.length === 0
                        ? 'この文書には見出しがありません'
                        : '一致する見出しがありません'}
                    </p>
                  ) : (
                    suggestions.matches.map((headingChoice, index) => (
                      <button
                        key={headingChoice.slug}
                        id={`${fieldId}-heading-${index}`}
                        type='button'
                        role='option'
                        aria-selected={index === suggestIndex}
                        // mousedown keeps focus in the field; the pick waits for click
                        // (docs/editor-pitfalls.md §13.3).
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => chooseHeading(headingChoice)}
                        // `px-2`, so the row's text lines up under the field's. No indent for h3:
                        // in a filtered list it would mislead.
                        className={`flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                          index === suggestIndex ? 'bg-zinc-200 dark:bg-zinc-700' : ''
                        }`}>
                        <span className='min-w-0 flex-1 truncate'>{headingChoice.text}</span>
                        {/* The fragment, shown so the author learns the slug; it truncates last. */}
                        <span className='max-w-[55%] shrink-0 truncate text-[10px] text-zinc-500 dark:text-zinc-400'>
                          #{headingChoice.slug}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {/* 適用, not 保存: it writes into the document, and 保存 is the autosave indicator's word
                            (§5.5.16). No cancel button: a ✕ was misread as 解除; Escape, a press elsewhere or
                            moving focus all cancel. Link colour with a hover fill, not filled: nothing else in the
                chrome is filled, so a fill would read as a weight this card doesn't carry. */}
            {/* `shrink-0`, or 適用 stacked vertically on a phone; the field gives (§5.5.19). */}
            <span className='shrink-0'>
              <ToolbarButton accent onClick={applyDraft}>
                適用
              </ToolbarButton>
            </span>
          </div>
        </div>
      ) : (
        <>
          {/* The href is half the point of the card (openOnClick is off), and the top line opens it.
                        A <button>, not an <a>: `window.open` passes noopener/noreferrer by hand (the
                        sanitizer's rel attributes don't apply in the editor), and the accessible name is set
                        explicitly since the visible text is a URL. */}
          <LinkFavicon key={href} href={href} />
          {/* Title above the URL when known (§5.5.10); the URL line always stays. The *top* line is
                        the one that opens, so a link without a fetchable title can still be opened. */}
          <div className='flex min-w-0 max-w-72 flex-col items-start'>
            {/* Hovering shows each line untruncated, via EditorTooltip (`group/tt relative`). */}
            {/* The tooltip is the line's sibling, so the button's text isn't read twice. */}
            <span className='group/tt relative w-full'>
              <button
                type='button'
                // The name follows what the press does (§5.5.18).
                aria-label={isFragment ? '見出しへ移動' : 'リンク先を開く'}
                onClick={
                  isFragment ? jump : () => window.open(href, '_blank', 'noopener,noreferrer')
                }
                className='link-bubble-open block w-full truncate rounded px-1.5 py-0.5 text-left text-xs text-[#0969da] hover:underline dark:text-[#4493f8]'>
                {title ?? displayHref(href)}
              </button>
              <EditorTooltip label={title ?? href} />
            </span>
            {title && (
              // Display only; `cursor-default`, since plain text would otherwise get the I-beam.
              <span className='group/tt relative w-full'>
                <span className='link-bubble-href block w-full cursor-default truncate px-1.5 text-[10px] leading-tight text-zinc-500 dark:text-zinc-400'>
                  {displayHref(href)}
                </span>
                <EditorTooltip label={href} />
              </span>
            )}
            {deckPageHint && (
              // A third line that wraps, in the editor's own amber (the footnote states' caution
              // colour), so it reads as the editor speaking (§16.10).
              <span className='link-bubble-deck-hint mt-0.5 block w-full whitespace-normal px-1.5 text-[10px] leading-tight text-[#9a6700] dark:text-[#d29922]'>
                埋め込みにするには Share →「Copy iframe code」の内容を貼り付けてください
              </span>
            )}
          </div>
          <span
            className='mx-1 h-5 w-px self-center bg-zinc-300 dark:bg-zinc-600'
            aria-hidden='true'
          />
          <ToolbarButton round title='コピー' onClick={copyHref}>
            <CopyIcon />
          </ToolbarButton>
          <ToolbarButton round title='編集' shortcut={OPEN_SHORTCUT} onClick={openField}>
            <PencilIcon />
          </ToolbarButton>
          {toEmbed && (
            <ToolbarButton round title='埋め込みにする' onClick={toEmbed}>
              {/* The glyph is the outcome, per provider (§7.3), via `embedMarkShapes`. */}
              <IconSvg shapes={embedMarkShapes(embedTarget?.provider)} />
            </ToolbarButton>
          )}
          {toBlob && (
            <ToolbarButton round title='コードブロックにする' onClick={toBlob}>
              {/* GitHub's mark: where the code comes from (§18.8, §19.2). */}
              <IconSvg shapes={GITHUB_MARK_SHAPES} />
            </ToolbarButton>
          )}
          {toCard && (
            <ToolbarButton round title='カードにする' onClick={toCard}>
              <CardIcon />
            </ToolbarButton>
          )}
          <ToolbarButton
            round
            destructive
            title='解除'
            onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}>
            <UnlinkIcon />
          </ToolbarButton>
        </>
      )}
    </BubbleMenu>
  );
}
