'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { ThumbnailField } from './ThumbnailField';
import { useDismiss } from './useDismiss';
import { useBodyScrollLock } from './useBodyScrollLock';

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

const inputClass =
  'w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className='block text-sm'>
      <span className='mb-1 block text-zinc-600 dark:text-zinc-400'>{label}</span>
      {children}
    </label>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  category: string;
  onCategoryChange: (value: string) => void;
  tags: string;
  onTagsChange: (value: string) => void;
  thumbnail: string;
  onThumbnailChange: (value: string) => void;
  body: string;
  isPublished: boolean;
  pending: boolean;
};

export function PostSettingsPanel({
  open,
  onClose,
  category,
  onCategoryChange,
  tags,
  onTagsChange,
  thumbnail,
  onThumbnailChange,
  body,
  isPublished,
  pending,
}: Props) {
  // Above `app/globals.css`'s own `min-width: 100rem` (§12.25), the backdrop goes
  // `pointer-events: none` and transparent — the drawer clears the editor column at that width, so
  // there is nothing left to block. That alone stops presses from reaching it and stops the
  // backdrop's own `onClick` from firing (a `pointer-events: none` element never receives one), but
  // `useDismiss`'s listener is on `document`, not the backdrop, so a press into the editor still
  // reaches it and still reads as "outside the drawer." Reading the backdrop's own computed style
  // at the moment of the press is what makes this one CSS breakpoint the only place the mode is
  // decided — no matching state in React, no resize listener, nothing to fall out of sync with it.
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useDismiss<HTMLDivElement>(open, () => {
    const backdrop = backdropRef.current;
    if (backdrop && getComputedStyle(backdrop).pointerEvents === 'none') return;
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

  // No forced focus in on open or restored on close, unlike WritingHelpDialog — matched to
  // InsertMenu instead, which has neither. This panel cycles open/closed multiple times around
  // image-bubble interactions in the body (setting or clearing a thumbnail), and a captured
  // "opener" from one open can be a transient button (e.g. the bubble's own サムネイルに設定) that
  // no longer exists or means anything by the next close — forcing focus back onto it stole DOM
  // focus from the editor and closed the bubble menu that was still needed (measured 2026-09-21:
  // 解除 became unreachable one open/close cycle after this component's first draft, which did
  // force focus, was written). Leaving focus alone is also what the phone's own sheet does.
  //
  // Enter in a text field submits the form by activating its first submit button (投稿/更新);
  // Escape itself is `useDismiss`'s job, not this handler's.
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
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
        onClick={onClose}
        className={`post-settings-backdrop fixed inset-0 z-[54] !mb-0 bg-black/40 ${open ? 'is-open' : ''}`}
      />
      <div
        id={SETTINGS_PANEL_ID}
        ref={panelRef}
        role='dialog'
        aria-label='記事の設定'
        onKeyDown={onKeyDown}
        className={`post-settings-drawer fixed top-0 right-0 bottom-0 z-[55] w-[calc(100%-2.5rem)] !mb-0 overflow-y-auto border-l border-zinc-300 bg-white px-4 py-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 sm:w-[380px] ${open ? 'is-open' : ''}`}>
        <div className='mb-3 flex items-center justify-between gap-3'>
          <h2 className='text-sm font-bold'>記事の設定</h2>
          <button
            type='button'
            aria-label='閉じる'
            onClick={onClose}
            className='rounded-full border border-zinc-300 px-2 py-0.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'>
            ×
          </button>
        </div>

        <div className='space-y-4'>
          <Field label='カテゴリ'>
            <input
              name='category'
              value={category}
              onChange={(event) => onCategoryChange(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label='タグ（カンマ区切り）'>
            <input
              name='tags'
              value={tags}
              onChange={(event) => onTagsChange(event.target.value)}
              className={inputClass}
            />
          </Field>
          <ThumbnailField value={thumbnail} onChange={onThumbnailChange} body={body} />
          {/* 下書きに戻す lives here rather than beside 更新 in the header. It is never wanted from
          the middle of writing, and a pinned bar would keep an unpublish one click away for the
          whole session; the panel is opened deliberately, which is the right gate for it. Zenn
          shapes the same pair this way — its header publishes, and taking a post back down is in
          the settings. Rendered only for a published post, so the panel has no dead control on a
          draft. */}
          {isPublished && (
            <div className='flex flex-wrap items-center justify-between gap-3 border-t border-zinc-300 pt-4 dark:border-zinc-700'>
              <span className='text-sm text-zinc-600 dark:text-zinc-400'>
                この記事は公開されています。
              </span>
              <button
                type='submit'
                name='intent'
                value='unpublish'
                disabled={pending}
                className='rounded border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800'>
                下書きに戻す
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
