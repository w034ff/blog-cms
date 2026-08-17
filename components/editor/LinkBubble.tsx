'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { getMarkRange } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { setLinkHighlight, type LinkHighlightRange } from './link-highlight-extension';
import { EditorTooltip } from './EditorTooltip';
import { ToolbarButton } from './ToolbarButton';
import { CopyIcon } from './svg/CopyIcon';
import { PencilIcon } from './svg/PencilIcon';
import { UnlinkIcon } from './svg/UnlinkIcon';

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

// The favicon of the origin a link resolves to, or null where there is no origin to ask (`tel:`,
// `mailto:`). A site-relative path and a bare fragment resolve against this blog's own origin, so
// an internal link shows this blog's icon — which is the honest answer rather than a special case.
//
// Root `/favicon.ico` and nothing else. Reading a `<link rel="icon">` would mean fetching and
// parsing the target's HTML, and that is the whole of the external-card project that
// link-card-requirements.md §8.1 defers — the cost this deliberately does not pay. The price is
// that the icon is simply absent on a site that declares its icon only in HTML.
//
// Both hosts in the corpus do serve the root path to a real browser (measured 2026-08-16 in the
// harness, zenn.dev and wikiwiki.jp). Worth knowing because a `curl` probe of the same two says
// otherwise — wikiwiki.jp answers 403 to it — so the browser is the instrument here, not a shell.
function faviconSrc(href: string): string | null {
  try {
    const url = new URL(href, window.location.origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}/favicon.ico`;
  } catch {
    return null;
  }
}

// Shown only once it has actually loaded. Failure is the common case (see above), and a reserved
// box that stays empty reads as a broken image, so nothing is drawn until the load succeeds — the
// card is anchored at its left edge, so the icon's arrival grows it rightwards rather than moving
// what the author is already reading.
//
// `no-referrer`: the request goes from the author's browser to the third-party origin, and the
// origin has no business knowing which page of this blog is being edited. It learns that someone
// asked for its favicon, which is the smallest thing that can be leaked and still show an icon.
//
// Mounted under a `key` of the href by its caller, so moving to another link resets `loaded` by
// remounting rather than by an effect that writes state back during render.
function LinkFavicon({ href }: { href: string }) {
  const src = faviconSrc(href);
  const [loaded, setLoaded] = useState(false);
  if (!src) return null;
  return (
    // A plain <img>, silenced the same way ThumbnailField and PostCard silence it: next/image
    // would need every origin an author might link to configured in advance, and this is a 16px
    // piece of editor chrome that never reaches the published page.
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

// The document range of the link the caret is in, for the highlight. Two positions again, and for
// the same reason `linkElementAt` needs two: at a link's right edge `getMarkRange` resolves to
// nothing (`childAfter` there is the non-link text that follows, so the walk stops before it
// starts), while the mark still reads as active. Asking at `from - 1` as well is what keeps the
// tint present at the position a click most often lands on.
function linkRangeAt(editor: Editor): LinkHighlightRange {
  const type = editor.schema.marks.link;
  if (!type) return null;
  const { from } = editor.state.selection;
  for (const pos of [from, from - 1]) {
    if (pos < 0) continue;
    const range = getMarkRange(editor.state.doc.resolve(pos), type);
    if (range) return { from: range.from, to: range.to };
  }
  return null;
}

// How an href is drawn on the card. `https://` comes off and nothing else does — not `http://`,
// which is the point: with only the default scheme hidden, the one that is not encrypted is the one
// that shows, which is the same trade Chrome's address bar makes and the reason this is safe rather
// than merely tidier. Relative paths, fragments and `mailto:` are untouched, having no scheme to
// drop or a meaningful one.
//
// Display only. What the card opens, copies and stores is the raw href, and the hover tooltip shows
// that raw form — the stripped line is for reading, the tooltip is for checking (§5.5.10).
function displayHref(href: string): string {
  return href.replace(/^https:\/\//i, '');
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
  // Whether the bubble menu plugin currently has the card on screen. Its `onShow`/`onHide` are the
  // only place that answer exists — see the highlight effect below for why asking `shouldShow`
  // instead is wrong. State rather than a ref, because the effect that reads it has to re-run when
  // it changes, and nothing else would make that happen: a blur produces no transaction.
  const [menuVisible, setMenuVisible] = useState(false);
  // The linked page's title, stored with the href it belongs to and read back only for a matching
  // one. Keeping the pair rather than a bare string is what makes the reset unnecessary: moving to
  // another link makes the stored title stop matching, so there is no window in which one link's
  // title is drawn under another's URL.
  const [fetchedTitle, setFetchedTitle] = useState<{ href: string; title: string } | null>(null);
  const editingRef = useRef(false);
  // Escape closes the card while the caret stays put; without this it would come straight back on
  // the next transaction. Cleared as soon as the caret leaves the link, so it never sticks.
  const dismissedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const href = currentHref(editor);
  const title = fetchedTitle?.href === href ? fetchedTitle.title : null;

  const signal = useCallback(
    (meta: 'show' | 'hide' | 'updatePosition') => {
      editor.view.dispatch(editor.state.tr.setMeta(MENU_KEY, meta));
    },
    [editor],
  );

  // Has the author left the card behind? The two rules that take it away — the editor's blur and
  // focus leaving for somewhere else entirely — both have to ask this, and asking it two different
  // ways is what broke the card's own buttons (§5.5.9).
  //
  // The card counts as a place the author can be. It is portalled to <body>, so pressing one of its
  // buttons moves focus out of the editor exactly as leaving for the page around it does; the blur
  // rule read only `hasFocus()`, hid the card a frame after mousedown, and the click never landed
  // because its target was gone by mouseup (measured 2026-08-16).
  //
  // `hasFocus()` rather than `view.dom.contains(active)` for the editor half: ProseMirror's answer
  // is about its own element, so a focusable control *inside* the document — the link card
  // NodeView's 変更 — counts as having left, which is the case §5.5.9 was written for.
  const focusLeft = useCallback(() => {
    const active = document.activeElement;
    if (active?.closest('.link-bubble')) return false;
    return !editor.view.hasFocus();
  }, [editor]);

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

  // Leave the URL field without applying it, and without touching focus — for the paths where
  // something else is already claiming it (the click that dismisses the card is also the click that
  // places the caret somewhere new).
  const abandonField = useCallback(() => {
    editingRef.current = false;
    setEditing(false);
    // Cancelling an assignment leaves no link under the caret, so the card has nothing left to show.
    if (!editor.isActive('link')) {
      signal('hide');
      return;
    }
    // Otherwise the card falls back to display mode — but only if the author is still in the
    // editor. The field can be left for somewhere that is not (the post's title, say), and the blur
    // rule below cannot answer that: the editor lost focus when the field took it, so leaving the
    // field for a third place fires no blur of its own. Same test as that rule, a frame later, so
    // 保存 and やめる — which focus the editor back — keep the card.
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

  // Which text the card is about, tinted while the card is up (§5.5.7). Recomputed on every render,
  // and this component re-renders on every transaction (`shouldRerenderOnTransaction`), so the tint
  // follows the caret from one link to the next and goes out the moment the card does — including
  // on Escape, which hides the card while the caret stays inside the link. `setLinkHighlight`
  // no-ops when the range is unchanged, which is what stops this from putting a transaction into
  // every render and re-rendering itself forever.
  //
  // Gated on `menuVisible` — the plugin's own answer — and not on `shouldShow` alone, because
  // `shouldShow` is only half of what decides whether the card is on screen. The plugin also hides
  // it when the editor loses focus to nothing, and it asks `shouldShow` again only on a transaction
  // that changes the selection or the document. Clicking the page margin is neither: it blurred the
  // editor, the card went away, `shouldShow` still said true, and the tint sat on the link with no
  // card above it until some later edit happened to clear it (measured 2026-08-16).
  useEffect(() => {
    if (!menuVisible || !shouldShow()) {
      setLinkHighlight(editor, null);
      return;
    }
    const link = linkRangeAt(editor);
    if (link) {
      setLinkHighlight(editor, link);
      return;
    }
    // `Mod-k` over a selection: no link exists yet, so light the text that is about to become one.
    const { from, to } = editor.state.selection;
    setLinkHighlight(editor, editingRef.current && from < to ? { from, to } : null);
  });

  // Clicking elsewhere closes the URL field, the way Docs' card behaves. Without this the field
  // stays open and re-anchors to wherever the caret went — measured before the change: it slid
  // 284px along the line while still claiming to be editing the link it was opened on. Display mode
  // needs no equivalent, because the caret leaving the link is already what hides the card.
  //
  // `mousedown`, not `click`: the same gesture places the caret, and by `click` the selection has
  // already moved, so `abandonField`'s `isActive` test would be asking about the new position
  // rather than the one being left. The card is portaled to <body>, so "outside" is a `closest()`
  // test against its own class and not a ref containment check.
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.link-bubble')) return;
      abandonField();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [abandonField, editing]);

  // The same departure by keyboard. Tab past the card's last button and focus leaves it for nothing
  // at all — the card is portalled to the end of <body>, so there is no next control to land on —
  // and without this the field stayed open, unfocused, until some later click happened to close it
  // (measured: focus on <body>, the field still mounted).
  //
  // Deferred a frame and answered from `document.activeElement` rather than from the event's
  // `relatedTarget`, because the two gestures that must *not* close look identical to the event.
  // Opening the field unmounts the 編集 button that focus is on, which is a focusout with a null
  // relatedTarget; so is tabbing away. A frame later they differ, because by then the effect above
  // has moved focus into the URL field.
  //
  // Runs in display mode too, and that is the other half of letting the card keep focus. Once a
  // press has parked focus on one of the card's own buttons, the editor is already blurred, so
  // leaving the page from there fires no blur of its own — the card would sit on a document nobody
  // is editing, which is the very state §5.5.9 exists to prevent. Registered while the card is on
  // screen at all; the `editing` term keeps it mounted for the field's own departures regardless.
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

  // The display card follows the editor's focus: if the author is not editing, a card describing
  // what surrounds the caret has nothing to be about. Reported as buttons that leave the card up —
  // the post's own form controls, and the link card NodeView's 変更 — and they share a shape: the
  // click dispatches no transaction, so the plugin never re-asks `shouldShow`, and the card simply
  // stays where it was.
  //
  // Deferred a frame and settled by `focusLeft()`, because blur alone does not mean the author left.
  // Measured 2026-08-16: a toolbar button emits blur *and* focus (its command chain focuses the
  // editor back), while the link card's 変更 emits blur alone. Hiding on the raw blur event would
  // take the card away every time the author reached for 太字 — and the toolbar is the one place
  // outside the editor that acts on the very selection the card is describing.
  //
  // Focus landing on the card itself is not leaving either, and asking `hasFocus()` alone here was
  // the bug that made コピー・編集・解除 unpressable: mousedown moved focus to the button, this
  // hid the card a frame later, and the click had no target left by mouseup.
  //
  // `dismissedRef` rather than `signal('hide')` alone: the picker the 変更 button opens dispatches
  // transactions of its own, and each would re-ask `shouldShow` and bring the card back. Focus
  // returning to the editor clears it, so coming back to the link shows the card again — which is
  // what separates this from Escape, whose dismissal is meant to outlast a click.
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
    // An assignment is answered by the selection and not by the DOM, and it has to be answered
    // before `linkElementAt` is asked at all. That function tries `from - 1` first — which is what
    // makes a caret at a link's right edge work — so selecting the text *immediately after* a link
    // and pressing Mod-k found that link's `<a>` and put the card over it, on the line above the
    // text being linked (measured 2026-08-17, §5.5.11). There is no link under the selection yet,
    // so there is nothing for the card to anchor to but the selection itself.
    if (editingRef.current && !editor.isActive('link')) return null;
    const anchor = linkElementAt(editor);
    // Null falls back to the plugin's own selection rect.
    return anchor
      ? { getBoundingClientRect: () => anchor.getBoundingClientRect(), contextElement: anchor }
      : null;
  }, [editor]);

  const options = useMemo(
    () => ({
      // Above the link. The card was below until 2026-08-16, on the reasoning that above would
      // cover the line being read — but the line being read is the link's own, and the card clears
      // that one either way. What it actually covers is a neighbour, and once the card grew a title
      // line it covered two whole paragraphs of them (measured: 47px tall). Above, those are
      // paragraphs the author has already read; below, they are the ones coming next. See §5.5.10.
      //
      // `flip` sends it back below where there is no room above — but "room" has to mean the
      // editor's own box, not the viewport. The toolbar is `sticky top-0 z-30` directly above the
      // content, so a link in the first line has viewport space above it and none that is free:
      // the card landed in the toolbar's band and, being `z-20`, went *under* it (measured — the
      // card was on screen and invisible). Giving flip the editor's element as its boundary states
      // that in the terms floating-ui already has, with no pixel constant to drift when the
      // toolbar's height changes.
      placement: 'top-start' as const,
      offset: 8,
      flip: { boundary: editor.view.dom },
      shift: true,
      // These three are the only report of whether the card is actually on screen. The class they
      // set suppresses the table toolbar; `setMenuVisible` hands the same fact to the highlight,
      // which otherwise has no way to learn that a blur took the card away. Setting state here is
      // safe — the plugin calls them from its view update, not from a render — and it is what makes
      // the effect re-run, since a blur dispatches no transaction to re-render us.
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
    // `editor` only, and it never changes for the life of this component — the reference stays as
    // stable as the empty list it replaced, which is what keeps the plugin from re-rendering us in
    // a loop.
    [editor],
  );

  // Where the card is, every time it changes shape. The plugin positions the card *before* it puts
  // it on screen — `meta === "show"` runs `updatePosition()` and then `show()`, and `updatePosition`
  // opens with `if (!this.isVisible) {` and a return — so a card the plugin is not already showing
  // is attached at the coordinates it last held. `hide()` clears visibility and opacity and leaves
  // `left`/`top` where they were, so Mod-k after a visit to any link put the card back at *that*
  // link, however far away the caret had moved (measured 2026-08-17, §5.5.11).
  //
  // Nothing brought it back either: the plugin recomputes on a transaction that moves the selection,
  // on a resize and on a scroll, and opening the field is none of those. On the first Mod-k of a
  // session there are no coordinates at all — `position: absolute` with no offsets leaves the card
  // at the document's top-left, and focusing the URL field there scrolled the page to the top.
  //
  // A layout effect so the correction lands in the same frame as the attach: floating-ui's
  // `computePosition` settles in microtasks, and those run before the paint that would otherwise
  // show the card at the stale place.
  //
  // Keyed on `editing` in both directions, though only the opening edge is measured. The card and
  // the URL field are different heights and `top-start` measures the card's own, so collapsing back
  // needs the same correction in principle — but every path that collapses the field also focuses
  // the editor, and that makes the plugin place the card itself (`focusHandler` runs `update` with
  // no `oldState`, which reads as a changed selection). Measured: the closing edge changes nothing
  // today. It is kept because the rule is "re-place the card whenever it changes shape", and a
  // future path that collapses the field without refocusing would need it.
  useLayoutEffect(() => {
    if (!menuVisible) return;
    signal('updatePosition');
  }, [editing, menuVisible, signal]);

  // Focus the URL field as it opens, with its contents selected so retyping a wrong URL is one
  // gesture. Focus leaving the editor does not hide the card: the plugin's blur handler ignores a
  // focus move into its own element.
  useEffect(() => {
    if (!editing) return;
    // `preventScroll`, because this focus happens while the card is still being placed: the effect
    // above has asked for the position, but floating-ui answers in a microtask and this runs first.
    // Without it, the first Mod-k of a session focused a card still sitting at the document's
    // top-left and the browser scrolled the whole page there to reveal it (measured 2026-08-17,
    // §5.5.11). Refusing the scroll is safe because its destination is a place the card is about to
    // leave: a microtask later it is placed against the selection, and a selection the author is
    // looking at is on screen. Scrolling a selection out of view before pressing Mod-k would leave
    // the field focused off screen, which is not measured — it was worse before this (the top).
    inputRef.current?.focus({ preventScroll: true });
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

  // The title of the page the link points at, asked for once per href while the card is up
  // (§5.5.10). Absent until it arrives and absent forever if it does not, which is the common
  // enough case — a Cloudflare-fronted site answers 403 — that the card has to read correctly
  // without it. It does: without a title the card is exactly what it was before this existed.
  //
  // Keyed on the href and aborted when that changes, so a slow answer for a link the caret has
  // already left cannot land on the next one. Only http(s) is asked about; a fragment or a
  // `mailto:` has no page to have a title.
  useEffect(() => {
    if (!menuVisible || editing) return;
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
      // Including AbortError: there is nothing to say and nothing to fall back to, because not
      // showing a title is already the resting state.
      .catch(() => {});
    return () => controller.abort();
  }, [editing, href, menuVisible]);

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
      // Docs' own card shape: a tall-ish rounded pill, a soft drop shadow rather than a hard
      // border, and enough padding that the three round hover targets don't touch each other. The
      // border is kept for the dark scheme, where a shadow alone leaves the card's edge invisible
      // against the editor surface.
      className='link-bubble z-20 flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.18)] dark:border-zinc-700 dark:bg-zinc-800'>
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
            className='w-72 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus:border-[#0969da] focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-[#4493f8]'
          />
          <ToolbarButton onClick={applyDraft}>保存</ToolbarButton>
          <ToolbarButton onClick={close}>やめる</ToolbarButton>
        </>
      ) : (
        <>
          {/* The href in full view is half the point of the card: with openOnClick off, the
              browser's hover status bar was the only way to see where a link went. It is also the
              button that opens it, the way Docs' card works — which is why the three remaining
              controls can be icons: the one action that needs its target spelled out already
              spells it out. `title` carries the untruncated href for a long URL.

              A <button>, not an <a>: the open goes through `window.open` so that noopener/noreferrer
              are passed by hand (this is the editor's own DOM, not the published page, so the
              anchor rel attributes the sanitizer adds are not involved). The accessible name is set
              explicitly, since the visible text is a URL and "https://…" read aloud says nothing
              about what the control does. Nothing here has to restate the pointer cursor the line's
              link colouring implies: app/globals.css gives every button one. */}
          <LinkFavicon key={href} href={href} />
          {/* Two lines when a title is known, one when it is not (§5.5.10). The URL line never
              leaves: §5.5.1-1 makes "where does this go" the reason this card exists — it is what
              repaid `openOnClick: false` — and a title answers what a page *is*, not where it
              goes. So the title is added above rather than substituted in.

              The rule for what is clickable is positional, not "the URL is": the top line opens the
              link and is drawn in the link colour, and that is the title when there is one and the
              URL when there is not. Written the other way — URL never clickable — a link whose
              title cannot be fetched (a Cloudflare-fronted site: 2 of 10 measured) would have no
              way to open it at all, which is exactly the trade §3 made and §5.5 repaid. */}
          <div className='flex min-w-0 max-w-72 flex-col items-start'>
            {/* Each line shows what it has, untruncated, on hover — both the title and a long URL
                are cut off by `max-w-72`. The editor's own tooltip rather than the native `title`
                attribute, for the reason ToolbarButton records: `title` renders near the cursor,
                on the browser's own delay, and cannot be styled to match anything. `group/tt
                relative` is what EditorTooltip positions against. */}
            {/* The tooltip is a sibling of the line rather than a child of it, in a wrapper that
                covers the same area. Inside, it would put a second copy of the line's own text
                into the element — invisible, but real, and the first thing to read the button's
                text back got both. ToolbarButton can nest it because its buttons hold an icon. */}
            <span className='group/tt relative w-full'>
              <button
                type='button'
                aria-label='リンク先を開く'
                onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}
                className='block w-full truncate rounded px-1.5 py-0.5 text-left text-xs text-[#0969da] hover:underline dark:text-[#4493f8]'>
                {title ?? displayHref(href)}
              </button>
              <EditorTooltip label={title ?? href} />
            </span>
            {title && (
              // Display only. The href is here to be read, and the card already carries a button
              // for the one thing anyone would want to do with it as text.
              //
              // `cursor-default` is the one cursor on this card that has to be said out loud. Every
              // button here takes the pointer from the base rule in app/globals.css, and this line
              // is not a button — it is plain text, which the browser gives the I-beam. That would
              // leave the only inert thing on the card wearing the cursor for text you work with.
              <span className='group/tt relative w-full'>
                <span className='link-bubble-href block w-full cursor-default truncate px-1.5 text-[10px] leading-tight text-zinc-500 dark:text-zinc-400'>
                  {displayHref(href)}
                </span>
                <EditorTooltip label={href} />
              </span>
            )}
          </div>
          <span
            className='mx-1 h-5 w-px self-center bg-zinc-200 dark:bg-zinc-600'
            aria-hidden='true'
          />
          <ToolbarButton round title='コピー' onClick={copyHref}>
            <CopyIcon />
          </ToolbarButton>
          <ToolbarButton
            round
            title='編集'
            shortcut={OPEN_SHORTCUT}
            onClick={() => openField(href)}>
            <PencilIcon />
          </ToolbarButton>
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
