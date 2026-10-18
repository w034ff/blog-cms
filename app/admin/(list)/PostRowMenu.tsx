'use client';

import Link from 'next/link';
import { useActionState, useId, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { deletePostAction } from '@/app/actions/posts';
import { pinPostAction, type PinPostState } from '@/app/actions/settings';
import { useDismiss, type DismissReason } from '@/components/editor/useDismiss';

// A row's less frequent actions — the Markdown download and 削除 — behind ⋯, so the list's loudest
// word is not a destructive one. 編集 leads it although the title already opens the editor: nothing
// on the row says the title does, and a touch screen shows no hover underline.
// A disclosure, not `role="menu"`: the panel holds a confirmation step, not a list of commands
// walked with arrow keys. Deleting takes a second click because nothing brings a post back —
// deletePost removes its revisions in the same transaction (docs/revision-requirements.md).
// `pin` is given only to an admin, on a published post (app/admin/(list)/PostListRows.tsx): the
// one pin is the site's, as its name is (docs/home-requirements.md §3).
export function PostRowMenu({
  id,
  viewHref,
  pin,
}: {
  id: number;
  viewHref: string | null;
  pin?: { pinned: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [pinState, pinAction] = useActionState<PinPostState, FormData>(pinPostAction, {});
  const [confirming, setConfirming] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The panel's buttons unmount with it, so a keyboard close hands focus back to ⋯ rather than
  // dropping it on <body>. A click elsewhere has put focus where the user wanted it.
  const close = (reason?: DismissReason) => {
    setOpen(false);
    setConfirming(false);
    if (reason !== 'outside') triggerRef.current?.focus();
  };
  const ref = useDismiss<HTMLDivElement>(open, close);
  // A pin that went through closes the panel; the row's ピックアップ badge says what changed. A
  // refusal keeps it open with the reason. Adjusted while rendering, not in an effect, as React
  // advises for state derived from a change.
  const [handledPinAt, setHandledPinAt] = useState(pinState.at);
  if (pinState.at !== handledPinAt) {
    setHandledPinAt(pinState.at);
    if (pinState.at !== undefined) setOpen(false);
  }

  return (
    <div ref={ref} className='relative'>
      <button
        ref={triggerRef}
        type='button'
        aria-label='その他の操作'
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
        className='flex h-8 w-8 items-center justify-center rounded-chip text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800'>
        <svg aria-hidden='true' viewBox='0 0 16 16' className='h-4 w-4' fill='currentColor'>
          <circle cx='3' cy='8' r='1.5' />
          <circle cx='8' cy='8' r='1.5' />
          <circle cx='13' cy='8' r='1.5' />
        </svg>
      </button>
      {open && (
        <div
          id={panelId}
          className='popup-panel absolute top-full right-0 z-20 mt-1 rounded-panel border border-zinc-200 bg-surface p-1 shadow-lg dark:border-zinc-800'>
          {confirming ? (
            <form action={deletePostAction} className='w-56 p-2'>
              <input type='hidden' name='id' value={id} />
              <p className='text-sm'>この記事を削除します。元に戻せません。</p>
              <div className='mt-3 flex justify-end gap-3'>
                {/* Focus lands on the safe answer, so Enter right after 削除 does not delete. */}
                <button
                  type='button'
                  autoFocus
                  onClick={() => close()}
                  className='text-sm text-zinc-600 hover:underline dark:text-zinc-400'>
                  やめる
                </button>
                <DeleteButton />
              </div>
            </form>
          ) : (
            <>
              <Link
                href={`/admin/posts/${id}/edit`}
                className='block rounded-chip px-3 py-1.5 text-sm whitespace-nowrap hover:bg-zinc-100 dark:hover:bg-zinc-800'>
                編集
              </Link>
              {/* The row's 表示, here only on a phone, where the row hides it to give the title
                  the width (app/admin/(list)/PostListRows.tsx). */}
              {viewHref && (
                <a
                  href={viewHref}
                  className='block rounded-chip px-3 py-1.5 text-sm whitespace-nowrap hover:bg-zinc-100 sm:hidden dark:hover:bg-zinc-800'>
                  表示
                </a>
              )}
              {pin && (
                <form action={pinAction}>
                  {/* Empty takes the pin off (app/actions/settings.ts pinPostAction). */}
                  <input type='hidden' name='id' value={pin.pinned ? '' : id} />
                  <PinButton pinned={pin.pinned} />
                  {pinState.error && (
                    <p
                      role='alert'
                      className='w-56 px-3 py-1.5 text-xs text-red-600 dark:text-red-400'>
                      {pinState.error}
                    </p>
                  )}
                </form>
              )}
              {/* A plain download: the route answers with Content-Disposition, so the list stays. */}
              <a
                href={`/admin/posts/${id}/markdown`}
                download
                onClick={() => close()}
                className='block rounded-chip px-3 py-1.5 text-sm whitespace-nowrap hover:bg-zinc-100 dark:hover:bg-zinc-800'>
                Markdown をダウンロード
              </a>
              {/* 削除 stands apart from the commands that open or export. `-mx-1` cancels the
                  panel's `p-1`, so the rule meets its border. */}
              <hr className='-mx-1 my-1 border-zinc-200 dark:border-zinc-800' />
              <button
                type='button'
                onClick={() => setConfirming(true)}
                className='block w-full rounded-chip px-3 py-1.5 text-left text-sm whitespace-nowrap text-red-600 hover:bg-zinc-100 dark:text-red-400 dark:hover:bg-zinc-800'>
                削除
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type='submit'
      disabled={pending}
      className='text-sm font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400'>
      削除する
    </button>
  );
}

function PinButton({ pinned }: { pinned: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type='submit'
      disabled={pending}
      className='block w-full rounded-chip px-3 py-1.5 text-left text-sm whitespace-nowrap hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800'>
      {pinned ? '固定を外す' : 'トップに固定'}
    </button>
  );
}
