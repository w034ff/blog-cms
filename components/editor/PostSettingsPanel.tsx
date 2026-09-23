'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useRouter } from 'next/navigation';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CATEGORIES, type CategoryId } from '@/lib/content';
import type { Tag } from '@/lib/types';
import { TagField } from './TagField';
import { ThumbnailField } from './ThumbnailField';
import { useDismiss } from './useDismiss';
import { useBodyScrollLock } from './useBodyScrollLock';
import { CloseButton } from './CloseButton';
import { ChevronRightIcon } from './svg/ChevronRightIcon';

// A drawer that slides in from the right, modal like the phone's own ＋ sheet
// (InsertMenu.tsx, docs/editor-requirements.md §12.18) — requested 2026-09-21, reversing this
// file's first revision the same day, which had gone the other way (see docs/editor-requirements.md
// §12.22 for both turns and why). Shares that sheet's dismiss mechanics: `useDismiss` closes on an
// outside `mousedown` or Escape, a separate full-screen backdrop dims everything behind it and
// closes on its own click, and `useBodyScrollLock` freezes the page while it is up — nothing here
// reaches the editor until the drawer is explicitly closed.
//
// Not modal past `min-width: 100rem` (§12.25) — wide enough that the drawer no longer overlaps the
// editor column, so there is nothing for a backdrop to protect. Dimming, blocking and dismissal all
// key off the backdrop's own computed style rather than React state (see the backdrop's and
// `useDismiss`'s own comments below) — page scroll is the one exception, and does track the same
// breakpoint as live React state (below), because it is not decided at a discrete moment the way a
// press or a click is: it has to hold or release continuously as the width crosses the line, which
// a one-shot computed-style read cannot do.
//
// **Always mounted, never conditionally rendered**, unlike InsertMenu. Its children are form
// fields — useAutosave and publish both read the live form with `new FormData(form)`, so a field
// that leaves the document leaves the payload (カテゴリ would fall back to its default and the
// thumbnail would come off, the hazard the original inline panel's own comment recorded). `open`
// never toggles mounting — a hidden form control still submits, which is the property this
// component exists to keep — only a class (`.is-open`, on the stable `post-settings-backdrop`/
// `post-settings-drawer` pair, app/globals.css) that both shows/hides the pair and, when motion is
// allowed, carries the open/close animation (§12.23). The backdrop is a second, equally persistent
// element for the same reason `useDismiss`'s ref has to go on the drawer alone: with the backdrop
// covering the whole screen there is no "outside" left for its outside-press check to catch, so
// the backdrop gets its own `onClick` instead (InsertMenu's own comment).
export const SETTINGS_PANEL_ID = 'post-settings-panel';

// カテゴリ as one button per entry of the fixed list (§12.32): every choice in sight, one press to
// change. Real radios under the buttons, not a `<select>` and not buttons with state of their own —
// the form reads `category` off the DOM like every other field here, and a radio group gets the
// arrow-key movement and the checked state a screen reader announces without any code for them.
// `aria-labelledby` rather than a wrapping `<label>`: a label associates with one control, and
// here there are as many as the list is long.
//
// Each radio is laid transparently over its whole button rather than `sr-only`: clipped to a
// pixel, it sat under its own label, so a press reached the label and not the control — the
// browser forwards that, but a test driving the radio itself found the label in the way.
function CategoryField({
  value,
  onChange,
}: {
  value: CategoryId;
  onChange: (value: CategoryId) => void;
}) {
  const labelId = useId();
  return (
    <div className='text-sm'>
      <span id={labelId} className='mb-1 block font-bold'>
        カテゴリ
      </span>
      <div role='radiogroup' aria-labelledby={labelId} className='flex gap-2'>
        {CATEGORIES.map(({ id, label }) => (
          <label
            key={id}
            className='relative flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded border border-zinc-300 px-3 py-2 text-zinc-700 has-[:checked]:border-zinc-900 has-[:checked]:bg-zinc-900 has-[:checked]:text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-zinc-400 dark:border-zinc-700 dark:text-zinc-300 dark:has-[:checked]:border-zinc-100 dark:has-[:checked]:bg-zinc-100 dark:has-[:checked]:text-zinc-900'>
            <input
              type='radio'
              name='category'
              value={id}
              checked={value === id}
              onChange={() => onChange(id)}
              className='absolute inset-0 cursor-pointer appearance-none opacity-0'
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  category: CategoryId;
  onCategoryChange: (value: CategoryId) => void;
  tags: string[];
  onTagsChange: (value: string[]) => void;
  tagDictionary: Tag[];
  thumbnail: string;
  onThumbnailChange: (value: string) => void;
  body: string;
  isPublished: boolean;
  // False until the first publish, which only the header's 投稿 makes (§12.27).
  everPublished: boolean;
  // Mirrors 投稿's own race guard (PostEditor.tsx `publishDisabled`), minus its "nothing to
  // update" clause: turning a current post off is always meaningful.
  publishToggleDisabled: boolean;
  // The last action's refusal, while PostEditor still shows it in the header.
  error: string | null;
  // The gear that opens this, where focus goes back on close (§12.29).
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  // The post's history page, or null while a brand-new post has no row yet
  // (docs/revision-requirements.md §5).
  historyHref: string | null;
  // True while edits are not yet persisted (§5): leaving would strand them, and an autosave still
  // in flight could land on top of a restore made from the history.
  historyDisabled: boolean;
};

export function PostSettingsPanel({
  open,
  onClose,
  category,
  onCategoryChange,
  tags,
  onTagsChange,
  tagDictionary,
  thumbnail,
  onThumbnailChange,
  body,
  isPublished,
  everPublished,
  publishToggleDisabled,
  error,
  returnFocusRef,
  historyHref,
  historyDisabled,
}: Props) {
  const router = useRouter();
  // Above `app/globals.css`'s own `min-width: 100rem` (§12.25), the backdrop goes
  // `pointer-events: none` and transparent — the drawer clears the editor column at that width, so
  // there is nothing left to block. That alone stops presses from reaching it and stops the
  // backdrop's own `onClick` from firing (a `pointer-events: none` element never receives one), but
  // `useDismiss`'s listener is on `document`, not the backdrop, so a press into the editor still
  // reaches it and still reads as "outside the drawer." Reading the backdrop's own computed style
  // at the moment of the press is what makes this one CSS breakpoint the only place the mode is
  // decided — no matching state in React, no resize listener, nothing to fall out of sync with it.
  //
  // Escape is not a press, and is not ignored the same way (§12.29): it closes at every width, but
  // past the line only while focus is inside the drawer — there the editor stays usable beside it,
  // and an Escape meant for a bubble menu or the slash menu must not take the drawer with it.
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useDismiss<HTMLDivElement>(open, (reason) => {
    const backdrop = backdropRef.current;
    const modal = !(backdrop && getComputedStyle(backdrop).pointerEvents === 'none');
    if (reason === 'outside' && !modal) return;
    if (
      reason === 'escape' &&
      !modal &&
      !document.activeElement?.closest(`#${SETTINGS_PANEL_ID}`)
    ) {
      return;
    }
    onClose();
  });

  // Tracks the same `min-width: 100rem` line as app/globals.css's own §12.25 rule, kept in sync
  // by construction (the identical query string, not a duplicated pixel value) rather than by
  // convention. `true` until the first effect runs, matching the narrow/modal behaviour SSR would
  // produce — harmless either way, since `settingsOpen` starts `false` and nothing here does
  // anything until a post-hydration open. Unlike the backdrop and `useDismiss`, this can't be
  // decided at the moment of an event: the lock has to hold or release for as long as the drawer
  // stays open, including through a mid-session resize across the line, which only a live
  // subscription (not a one-shot read) can track.
  const [lockScroll, setLockScroll] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 100rem)');
    const sync = () => setLockScroll(!query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  useBodyScrollLock(open && lockScroll);

  // Focus (§12.29). On open it moves to the drawer itself (`tabIndex={-1}`), not to カテゴリ: a
  // field would raise the phone's keyboard the moment the drawer slides in, and the dialog's own
  // name is what a screen reader should announce. On close it goes back to the gear, which is the
  // only way this opens — but only when it was inside the drawer or had fallen to <body> (a press
  // on the backdrop). The first draft of this component returned focus to whatever held it at open
  // time; after an image-bubble round trip that was the bubble's own button, and restoring it stole
  // focus from the editor and closed the bubble with 解除 still needed (measured 2026-09-21). A
  // fixed target plus the "was it ours" check cannot do that: focus that the author put in the
  // editor stays there.
  const wasOpen = useRef(false);
  useEffect(() => {
    const panel = panelRef.current;
    if (open && !wasOpen.current) {
      panel?.focus({ preventScroll: true });
    } else if (!open && wasOpen.current) {
      const active = document.activeElement;
      if (active === document.body || (panel && panel.contains(active))) {
        returnFocusRef.current?.focus({ preventScroll: true });
      }
    }
    wasOpen.current = open;
  }, [open, panelRef, returnFocusRef]);

  // While modal (below `min-width: 100rem`, where `lockScroll` holds), Tab wraps inside the drawer:
  // the backdrop blocks the pointer from the page behind, and without this the keyboard walked
  // straight out into the editor under it. Past the line the drawer is not modal and Tab leaves it
  // as it would any sidebar.
  function wrapTab(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const panel = panelRef.current;
    if (!lockScroll || !panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // Enter in a text field submits the form by activating its first submit button (投稿/更新);
  // Escape itself is `useDismiss`'s job, not this handler's.
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
    if (event.key === 'Tab') wrapTab(event);
  }

  return (
    <>
      {/* Dims the post and the header underneath (z-[54], above the header's z-40 and the
          toolbar's z-30) and closes the drawer on a click anywhere outside it.

          `!mb-0` on both this and the drawer below: wherever in the tree PostEditor.tsx mounts
          this component, it risks landing among `space-y-*` siblings (a `space-y-N` utility gives
          every non-last child a `margin-bottom`). A `position: fixed` box's `bottom-0` resolves
          against its own margin box, so an inherited margin-bottom silently shortens it — measured
          788px on an 800px screen (12px short, from a `space-y-3` ancestor) with the true bottom
          strip of the page left undimmed. `!important` is the reliable fix because it holds
          regardless of DOM position, not just for wherever the component happens to render today.

          `post-settings-backdrop`/`post-settings-drawer` and `is-open` (app/globals.css) carry the
          open/close animation — a stable pair of classes rather than the `open ? '…' : 'hidden'`
          full-string swap this used before, because an entrance/exit transition needs the element
          present across both states for `@starting-style` and `transition-behavior: allow-discrete`
          to have something to interpolate. The show/hide itself (`display: none` unless `.is-open`)
          is declared unconditionally in that file, so a reduced-motion viewer still gets a correct,
          instant toggle — only the animation is gated on `prefers-reduced-motion`.

          This is what a narrow screen taps to reach: the drawer below is `calc(100% - 2.5rem)`
          wide rather than `w-full` (requested 2026-09-21), leaving a 40px strip of this backdrop
          showing and pressable on the left. `w-full` would have covered it entirely, and with it
          the only other way to close on a phone besides ×  — Escape has no touch equivalent. The
          ＋ sheet's own mobile version (InsertMenu.tsx, §12.18) makes the same trade for the same
          reason: it caps its height at `44vh` rather than filling the screen, so its own backdrop
          stays reachable above it.

          Wide desktop (`min-width: 100rem`, §12.25 in app/globals.css) goes further and drops the
          modal behaviour outright: past that width the drawer no longer overlaps the editor
          column, so this backdrop turns transparent and `pointer-events: none` there — nothing to
          dim and nothing to block. */}
      <div
        ref={backdropRef}
        aria-hidden='true'
        // The press closes the drawer on `mousedown` (useDismiss) and focus goes back to the gear
        // in the same turn; the press's own default then moved focus to <body>, undoing it.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClose}
        className={`post-settings-backdrop fixed inset-0 z-[54] !mb-0 bg-black/40 ${open ? 'is-open' : ''}`}
      />
      <div
        id={SETTINGS_PANEL_ID}
        ref={panelRef}
        role='dialog'
        aria-label='記事の設定'
        aria-modal={lockScroll ? true : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`post-settings-drawer outline-none fixed top-0 right-0 bottom-0 z-[55] w-[calc(100%-2.5rem)] !mb-0 overflow-y-auto border-l border-zinc-300 bg-white px-4 py-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 sm:w-[380px] ${open ? 'is-open' : ''}`}>
        <div className='mb-3 flex items-center justify-between gap-3'>
          <h2 className='text-base font-bold'>記事の設定</h2>
          <CloseButton onClick={onClose} />
        </div>

        <div className='space-y-4'>
          {/* サムネイル first: it is the post's face on every card, and the one field here whose
          state (chosen / picked from the body / none) is worth seeing the moment the drawer opens
          (requested 2026-09-21). */}
          <ThumbnailField value={thumbnail} onChange={onThumbnailChange} body={body} />
          <CategoryField value={category} onChange={onCategoryChange} />
          <TagField value={tags} onChange={onTagsChange} dictionary={tagDictionary} />
          {/* 公開 — the post's visibility as a switch, at the end of the group so it is decided
          after the fields above are checked (docs/editor-requirements.md §12.27). The header keeps
          投稿/更新 as the everyday way to publish; this is where the state is read and where a post
          goes back to a draft. Not on the header bar: a pinned unpublish would sit one click away
          for the whole writing session.

          A submit button wearing `role='switch'`, not a checkbox: it sends the same `intent` 投稿
          and 下書きに戻す sent, so the server-side checks (title required, footnotes) apply
          unchanged, and it never flips on its own — `aria-checked` is the server's answer
          (`isPublished`), so a refused publish leaves it where it was. The header's 投稿 is still
          the form's first submit button, which is what an Enter in a field would activate, and
          blockImplicitSubmit cancels that anyway.

          Only once the post has been published. The first publish stamps a date that never changes
          and puts the URL out, so it is not the reversible act a switch stands for; it stays with
          投稿 alone. From then on, off and on again restore the post as it was dated. */}
          {everPublished && (
            <div className='space-y-2 border-t border-zinc-300 pt-4 dark:border-zinc-700'>
              {/* A heading a step below the drawer title, and the same as every field's own
              name above it (サムネイル・カテゴリ・タグ, 14px bold — matched 2026-09-23 so the
              drawer has one kind of label; grey is left to the notes under a field). */}
              <h3 className='text-sm font-bold'>公開状態</h3>
              <div className='flex items-center gap-3'>
                {/* Named 公開, not by the heading: "公開状態, on" leaves the direction open, and
                the name is what fixes it — on means public. */}
                <button
                  type='submit'
                  name='intent'
                  value={isPublished ? 'unpublish' : 'publish'}
                  role='switch'
                  aria-checked={isPublished}
                  aria-label='公開'
                  disabled={publishToggleDisabled}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${isPublished ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-300 dark:bg-zinc-600'}`}>
                  <span
                    aria-hidden='true'
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform dark:bg-zinc-900 ${isPublished ? 'translate-x-[1.375rem]' : 'translate-x-0.5'}`}
                  />
                </button>
                {/* The state in words, right of the switch it describes (the switch leads the row,
                on the column's left edge), coloured with the track: dark when public, muted as a
                draft. 公開中 rather than 公開, so it reads as a state and not a label. No in-flight
                wording — the switch is disabled while the action runs, and the word changes once
                it settles. Hidden from assistive tech: `aria-checked` already says it. */}
                <span
                  aria-hidden='true'
                  className={`text-sm ${isPublished ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  {isPublished ? '公開中' : '下書き'}
                </span>
              </div>
              {/* The header shows the same message, but this drawer is modal and dims the header
            beneath it — a refusal caused by this switch would otherwise land out of reach. */}
              {error && (
                <p role='alert' className='text-sm text-red-600'>
                  {error}
                </p>
              )}
            </div>
          )}
          {/* リビジョン履歴 (docs/revision-requirements.md §5). A bordered full-width row with a
          trailing › because it leaves the screen — the fields above act in place. No section
          heading: the row's own words are the name, and a heading over it would say them twice.

          A button that navigates rather than a link, because it has to be disableable: an in-app
          navigation gets no beforeunload guard, so while edits are unsaved this is the only thing
          stopping them from being left behind. Also how pending edits are discarded — the history
          lists 公開中の記事 first. 40px tall at every width: the drawer's other rows are that on
          touch, and a row this wide gains nothing from being shorter on a pointer. */}
          {historyHref !== null && (
            <div className='border-t border-zinc-300 pt-4 dark:border-zinc-700'>
              <button
                type='button'
                disabled={historyDisabled}
                onClick={() => router.push(historyHref)}
                className='flex min-h-10 w-full items-center justify-between gap-2 rounded border border-zinc-300 px-3 text-left text-sm hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800'>
                リビジョン履歴
                <ChevronRightIcon />
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
