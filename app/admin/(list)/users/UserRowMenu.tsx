'use client';

import { useId, useRef, useState } from 'react';
import {
  deleteUserAction,
  removeInviteAction,
  suspendUserAction,
  unsuspendUserAction,
} from '@/app/actions/users';
import { useDismiss, type DismissReason } from '@/components/editor/useDismiss';
import {
  CANCEL_LABEL,
  DELETE_ACTION_BUTTON,
  formatDeleteConfirmationMessage,
  MENU_DELETE,
  MENU_REMOVE_INVITE,
  MENU_SUSPEND,
  MENU_UNSUSPEND,
  SUSPEND_ACTION_BUTTON,
  SUSPEND_CONFIRMATION_MESSAGE,
  SUSPEND_WITHDRAWING_CONFIRMATION_MESSAGE,
} from './constants';

export type UserMenuTarget =
  | { type: 'invite'; email: string }
  | {
      type: 'user';
      id: number;
      role: 'admin' | 'author';
      suspended: boolean;
      withdrawing: boolean;
      postCount: number;
      scribbleCount: number;
    };

export function UserRowMenu({ target }: { target: UserMenuTarget }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<'suspend' | 'delete' | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = (reason?: DismissReason) => {
    setOpen(false);
    setConfirming(null);
    setDeleteError(null);
    setDeletePending(false);
    if (reason !== 'outside') triggerRef.current?.focus();
  };
  const ref = useDismiss<HTMLDivElement>(open, close);

  // Admin rows have no menu (docs/multi-author-requirements.md §2, §9.5).
  if (target.type === 'user' && target.role === 'admin') {
    return null;
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
          {target.type === 'invite' ? (
            <form
              action={async (formData) => {
                await removeInviteAction({}, formData);
                close();
              }}>
              <input type='hidden' name='email' value={target.email} />
              <button
                type='submit'
                className='block w-full rounded-chip px-3 py-1.5 text-left text-sm whitespace-nowrap text-red-600 hover:bg-zinc-100 dark:text-red-400 dark:hover:bg-zinc-800'>
                {MENU_REMOVE_INVITE}
              </button>
            </form>
          ) : target.suspended ? (
            confirming === 'delete' ? (
              <form
                action={async (formData) => {
                  setDeletePending(true);
                  setDeleteError(null);
                  const res = await deleteUserAction({}, formData);
                  if (res?.error) {
                    setDeleteError(res.error);
                    setDeletePending(false);
                  } else {
                    close();
                  }
                }}
                className='w-64 p-2'>
                <input type='hidden' name='id' value={target.id} />
                <p className='text-sm'>
                  {formatDeleteConfirmationMessage(target.postCount, target.scribbleCount)}
                </p>
                <div className='mt-3 flex justify-end gap-3'>
                  <button
                    type='button'
                    autoFocus
                    onClick={() => close()}
                    className='text-sm text-zinc-600 hover:underline dark:text-zinc-400'>
                    {CANCEL_LABEL}
                  </button>
                  <button
                    type='submit'
                    disabled={deletePending}
                    className='text-sm font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400'>
                    {DELETE_ACTION_BUTTON}
                  </button>
                </div>
                {deleteError && (
                  <p role='alert' className='mt-2 text-xs text-red-700 dark:text-red-400'>
                    {deleteError}
                  </p>
                )}
              </form>
            ) : (
              <>
                <form
                  action={async (formData) => {
                    await unsuspendUserAction({}, formData);
                    close();
                  }}>
                  <input type='hidden' name='id' value={target.id} />
                  <button
                    type='submit'
                    className='block w-full rounded-chip px-3 py-1.5 text-left text-sm whitespace-nowrap hover:bg-zinc-100 dark:hover:bg-zinc-800'>
                    {MENU_UNSUSPEND}
                  </button>
                </form>
                <button
                  type='button'
                  onClick={() => setConfirming('delete')}
                  className='block w-full rounded-chip px-3 py-1.5 text-left text-sm whitespace-nowrap text-red-600 hover:bg-zinc-100 dark:text-red-400 dark:hover:bg-zinc-800'>
                  {MENU_DELETE}
                </button>
              </>
            )
          ) : confirming === 'suspend' ? (
            <form
              action={async (formData) => {
                await suspendUserAction({}, formData);
                close();
              }}
              className='w-64 p-2'>
              <input type='hidden' name='id' value={target.id} />
              <p className='text-sm'>
                {target.withdrawing
                  ? SUSPEND_WITHDRAWING_CONFIRMATION_MESSAGE
                  : SUSPEND_CONFIRMATION_MESSAGE}
              </p>
              <div className='mt-3 flex justify-end gap-3'>
                <button
                  type='button'
                  autoFocus
                  onClick={() => close()}
                  className='text-sm text-zinc-600 hover:underline dark:text-zinc-400'>
                  {CANCEL_LABEL}
                </button>
                <button
                  type='submit'
                  className='text-sm font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400'>
                  {SUSPEND_ACTION_BUTTON}
                </button>
              </div>
            </form>
          ) : (
            <button
              type='button'
              onClick={() => setConfirming('suspend')}
              className='block w-full rounded-chip px-3 py-1.5 text-left text-sm whitespace-nowrap text-red-600 hover:bg-zinc-100 dark:text-red-400 dark:hover:bg-zinc-800'>
              {MENU_SUSPEND}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
