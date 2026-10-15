'use client';

import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { deletePostAction } from '@/app/actions/posts';
import { useDismiss, type DismissReason } from '@/components/editor/useDismiss';

// A row's less frequent actions — the Markdown download and 削除 — behind ⋯, so the list's loudest
// word is not a destructive one. 編集 leads it although the title already opens the editor: nothing
// on the row says the title does, and a touch screen shows no hover underline.
// A disclosure, not `role="menu"`: the panel holds a confirmation step, not a list of commands
// walked with arrow keys. Deleting takes a second click because nothing brings a post back —
// deletePost removes its revisions in the same transaction (docs/revision-requirements.md).
export function PostRowMenu({
  id,
  slug,
  viewHref = slug ? `/posts/${slug}` : null,
}: {
  id: number;
  slug: string | null;
  viewHref?: string | null;
}) {
  const [open, setOpen] = useState(false);
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
          className='admin-popup absolute top-full right-0 z-20 mt-1 rounded-panel border border-zinc-200 bg-surface p-1 shadow-lg dark:border-zinc-800'>
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
                  the width (app/admin/(list)/page.tsx). */}
              {viewHref && (
                <a
                  href={viewHref}
                  className='block rounded-chip px-3 py-1.5 text-sm whitespace-nowrap hover:bg-zinc-100 sm:hidden dark:hover:bg-zinc-800'>
                  表示
                </a>
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
