'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useRouter } from 'next/navigation';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CATEGORIES, type CategoryId, type PostCategory, type PostKind } from '@/lib/content';
import type { DictionaryTag } from '@/lib/types';
import { TagField } from './TagField';
import { ThumbnailField } from './ThumbnailField';
import { useDismiss } from './useDismiss';
import { useBodyScrollLock } from './useBodyScrollLock';
import { CloseButton } from './CloseButton';
import { CheckIcon } from './svg/CheckIcon';
import { ChevronRightIcon } from './svg/ChevronRightIcon';
import { CodeBlockIcon } from './svg/CodeBlockIcon';
import { PencilIcon } from './svg/PencilIcon';

// A modal drawer from the right (docs/editor-requirements.md §12.22), with the ＋ sheet's dismiss
// mechanics: useDismiss, a backdrop that closes on its own click, and useBodyScrollLock. Not modal
// past `min-width: 106rem` (§12.25), where it clears the editor column: presses read the
// backdrop's computed style at the moment they happen, while the scroll lock tracks the breakpoint
// live because it must hold or release continuously.
//
// **Always mounted, never conditionally rendered.** Its children are form fields that useAutosave
// and publish read via `new FormData(form)`, so a field leaving the document leaves the payload.
// `.is-open` only shows/hides and animates (§12.23).
export const SETTINGS_PANEL_ID = 'post-settings-panel';

// Each category's mark: a stroke glyph on a tinted tile. A Record over CategoryId, so a category
// added to CATEGORIES fails the type check until it has one. Decoration only — the title names it.
const CATEGORY_ICONS: Record<CategoryId, { Icon: () => React.JSX.Element; tile: string }> = {
  tech: { Icon: CodeBlockIcon, tile: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
  blog: {
    Icon: PencilIcon,
    tile: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  },
};

// カテゴリ as one card per entry (§12.32). Real radios, so the form reads `category` off the DOM
// and arrow keys and announcements come free; `aria-labelledby` on the group because there are
// many controls. Each radio covers its card transparently rather than `sr-only` (a clipped radio
// sat under its label, in a test's way), named by the title and described by the rest. Selected is
// a doubled edge and a check, not a fill, so colour alone does not carry the state.
function CategoryField({
  value,
  onChange,
}: {
  value: PostCategory;
  onChange: (value: CategoryId) => void;
}) {
  const labelId = useId();
  return (
    <div className='text-sm'>
      <span id={labelId} className='mb-1 block font-bold'>
        カテゴリ
      </span>
      <div role='radiogroup' aria-labelledby={labelId} className='grid grid-cols-2 gap-2'>
        {CATEGORIES.map(({ id, label, description }) => {
          const { Icon, tile } = CATEGORY_ICONS[id];
          return (
            <label
              key={id}
              className='relative flex cursor-pointer flex-col gap-1.5 rounded-panel border border-zinc-300 p-3 text-zinc-800 has-[:checked]:border-zinc-900 has-[:checked]:bg-zinc-50 has-[:checked]:ring-1 has-[:checked]:ring-zinc-900 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-zinc-400 dark:border-zinc-700 dark:text-zinc-200 dark:has-[:checked]:border-zinc-100 dark:has-[:checked]:bg-zinc-800 dark:has-[:checked]:ring-zinc-100'>
              <input
                type='radio'
                name='category'
                value={id}
                checked={value === id}
                onChange={() => onChange(id)}
                aria-labelledby={`${labelId}-${id}`}
                aria-describedby={`${labelId}-${id}-description`}
                className='peer absolute inset-0 cursor-pointer appearance-none opacity-0'
              />
              <span className='flex items-center gap-2'>
                <span className={`rounded-chip p-1.5 ${tile}`}>
                  <Icon />
                </span>
                <span id={`${labelId}-${id}`} className='font-bold'>
                  {label}
                </span>
              </span>
              <span
                id={`${labelId}-${id}-description`}
                className='text-xs leading-relaxed text-zinc-500 [word-break:auto-phrase] dark:text-zinc-400'>
                {description}
              </span>
              <span className='absolute top-2 right-2 hidden rounded-full bg-zinc-900 p-0.5 text-white peer-checked:block dark:bg-zinc-100 dark:text-zinc-900'>
                <CheckIcon />
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  category: PostCategory;
  onCategoryChange: (value: CategoryId) => void;
  tags: string[];
  onTagsChange: (value: string[]) => void;
  tagDictionary: DictionaryTag[];
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
  // A publish refused for カテゴリ not chosen (§12.32); shown under the field only.
  categoryError: string | null;
  // The gear that opens this, where focus goes back on close (§12.29).
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  // The post's history page, or null while a brand-new post has no row yet
  // (docs/revision-requirements.md §5).
  historyHref: string | null;
  // True while edits are not yet persisted (§5): leaving would strand them, and an autosave still
  // in flight could land on top of a restore made from the history.
  historyDisabled: boolean;
  // Post kind: scribbles omit category and thumbnail fields (docs/scribble-requirements.md §3.2).
  kind: PostKind;
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
  categoryError,
  returnFocusRef,
  historyHref,
  historyDisabled,
  kind,
}: Props) {
  const router = useRouter();
  // Past `min-width: 106rem` (§12.25) the backdrop is `pointer-events: none`, but useDismiss listens
  // on `document`, so it reads the backdrop's computed style at the press: the CSS breakpoint stays
  // the only place the mode is decided. Escape (§12.29) closes at every width, but past the line only
  // while focus is inside the drawer, so an Escape meant for a bubble menu doesn't take it.
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

  // The same `min-width: 106rem` query string as §12.25's CSS, tracked live because the lock must
  // follow a resize across the line. `true` (modal) until the first effect, as SSR would render.
  const [lockScroll, setLockScroll] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 106rem)');
    const sync = () => setLockScroll(!query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  useBodyScrollLock(open && lockScroll);

  // Focus (§12.29): on open to the drawer itself, not a field that would raise the phone keyboard.
  // On close back to the gear, but only if focus was inside the drawer or on <body>; focus the
  // author put in the editor stays there (restoring "whatever had it at open" once stole it).
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

  // While modal, Tab wraps inside the drawer; past the line it leaves like any sidebar.
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

          `!mb-0` on both: a `space-y-*` parent's margin-bottom shortens a fixed box's `bottom-0`
          (§12.22). The stable class pair plus `.is-open` lets `@starting-style` animate both
          directions (§12.23); the show/hide itself is unconditional, so reduced motion still
          toggles instantly.

          This is what a narrow screen taps to reach: the drawer below is `calc(100% - 2.5rem)`
          wide rather than `w-full` (requested 2026-09-21), leaving a 40px strip of this backdrop
          showing and pressable on the left. `w-full` would have covered it entirely, and with it
          the only other way to close on a phone besides ×  — Escape has no touch equivalent. The
          ＋ sheet's own mobile version (InsertMenu.tsx, §12.18) makes the same trade for the same
          reason: it caps its height at `44vh` rather than filling the screen, so its own backdrop
          stays reachable above it.

          Wide desktop (`min-width: 106rem`, §12.25 in app/globals.css) goes further and drops the
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
          {/* サムネイル first: the post's face, and the one state worth seeing on open.
              Omitted for scribbles (docs/scribble-requirements.md §3.2). */}
          {kind !== 'scribble' && (
            <ThumbnailField value={thumbnail} onChange={onThumbnailChange} body={body} />
          )}
          {kind !== 'scribble' && (
            <div>
              <CategoryField value={category} onChange={onCategoryChange} />
              {categoryError && (
                <p role='alert' className='mt-1 text-sm text-red-600'>
                  {categoryError}
                </p>
              )}
            </div>
          )}
          <TagField value={tags} onChange={onTagsChange} dictionary={tagDictionary} />
          {/* 公開 as a switch, last in the group (docs/editor-requirements.md §12.27); not on the
          header, where unpublish would sit one click away all session. A submit button with
          `role='switch'`, sending the same `intent` as 投稿/下書きに戻す so the server checks apply;
          `aria-checked` is the server's answer, so a refused publish leaves it. Shown only after the
          first publish, which stamps a permanent date and is not reversible. */}
          {everPublished && (
            <div className='space-y-2 border-t border-zinc-300 pt-4 dark:border-zinc-700'>
              {/* Styled like every field's label, so the drawer has one kind. */}
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
                {/* The state in words (公開中 reads as a state), coloured with the track. Hidden from
                assistive tech, which has `aria-checked`. */}
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
          {/* リビジョン履歴 (docs/revision-requirements.md §5), with a trailing › because it leaves
          the screen. A button, not a link, because it must be disableable: in-app navigation has
          no beforeunload guard, so this is what keeps unsaved edits from being left behind. */}
          {historyHref !== null && (
            <div className='border-t border-zinc-300 pt-4 dark:border-zinc-700'>
              <button
                type='button'
                disabled={historyDisabled}
                onClick={() => router.push(historyHref)}
                className='flex min-h-10 w-full items-center justify-between gap-2 rounded-box border border-zinc-300 px-3 text-left text-sm hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800'>
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
