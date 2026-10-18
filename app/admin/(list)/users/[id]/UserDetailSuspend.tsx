'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { suspendUserAction, unsuspendUserAction } from '@/app/actions/users';
import {
  CANCEL_LABEL,
  MENU_SUSPEND,
  MENU_UNSUSPEND,
  SUSPEND_ACTION_BUTTON,
  SUSPEND_CONFIRMATION_MESSAGE,
} from '../constants';

// Suspend/unsuspend controls for author accounts (docs/multi-author-requirements.md §10.6).
// Admin accounts show no suspend button (§2).
export function UserDetailSuspend({
  user,
}: {
  user: { id: number; role: 'admin' | 'author'; suspendedAt: string | null };
}) {
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  if (user.role === 'admin') {
    return null;
  }

  if (user.suspendedAt !== null) {
    return (
      <div>
        <form
          action={async (formData) => {
            await unsuspendUserAction({}, formData);
            router.refresh();
          }}>
          <input type='hidden' name='id' value={user.id} />
          <button
            type='submit'
            className='rounded-box border border-zinc-300 bg-surface px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'>
            {MENU_UNSUSPEND}
          </button>
        </form>
      </div>
    );
  }

  if (confirming) {
    return (
      <form
        action={async (formData) => {
          await suspendUserAction({}, formData);
          setConfirming(false);
          router.refresh();
        }}
        className='max-w-md rounded-panel border border-zinc-200 bg-surface p-4 dark:border-zinc-800'>
        <input type='hidden' name='id' value={user.id} />
        <p className='text-sm'>{SUSPEND_CONFIRMATION_MESSAGE}</p>
        <div className='mt-3 flex justify-end gap-3'>
          <button
            type='button'
            autoFocus
            onClick={() => setConfirming(false)}
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
    );
  }

  return (
    <div>
      <button
        type='button'
        onClick={() => setConfirming(true)}
        className='rounded-box border border-red-300 bg-surface px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30'>
        {MENU_SUSPEND}
      </button>
    </div>
  );
}
