'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteUserAction, suspendUserAction, unsuspendUserAction } from '@/app/actions/users';
import {
  CANCEL_LABEL,
  DELETE_ACTION_BUTTON,
  formatDeleteConfirmationMessage,
  MENU_DELETE,
  MENU_SUSPEND,
  MENU_UNSUSPEND,
  SUSPEND_ACTION_BUTTON,
  SUSPEND_CONFIRMATION_MESSAGE,
  SUSPEND_WITHDRAWING_CONFIRMATION_MESSAGE,
} from '../constants';
import { PANEL_CONFIRM_CANCEL_CLASS, PANEL_CONFIRM_DANGER_CLASS } from '../../panel-confirm';

// Suspend/unsuspend and deletion controls for author accounts (docs/multi-author-requirements.md §10.6, §12.4).
// Admin accounts show no suspend or delete button (docs/multi-author-requirements.md §2, §12.4).
export function UserDetailSuspend({
  user,
  postCount,
  scribbleCount,
}: {
  user: {
    id: number;
    role: 'admin' | 'author';
    suspendedAt: string | null;
    withdrawalDueAt: string | null;
  };
  // What the delete confirmation says goes with the account, drafts included (§12.4).
  postCount: number;
  scribbleCount: number;
}) {
  const [confirmingSuspend, setConfirmingSuspend] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const router = useRouter();

  // Navigates from the awaited result, not from an effect on returned state: the action
  // revalidates this page, which then renders the 404 for the deleted id and unmounts this
  // component before an effect could run.
  const deleteAction = async (formData: FormData) => {
    setDeletePending(true);
    setDeleteError(null);
    const result = await deleteUserAction({}, formData);
    if (result.error) {
      setDeleteError(result.error);
      setDeletePending(false);
      return;
    }
    router.push('/admin/users');
  };

  if (user.role === 'admin') {
    return null;
  }

  if (user.suspendedAt !== null) {
    if (confirmingDelete) {
      return (
        <form
          action={deleteAction}
          className='max-w-md rounded-panel border border-zinc-200 bg-surface p-4 dark:border-zinc-800'>
          <input type='hidden' name='id' value={user.id} />
          <p className='text-sm'>{formatDeleteConfirmationMessage(postCount, scribbleCount)}</p>
          <div className='mt-3 flex justify-end gap-3'>
            <button
              type='button'
              autoFocus
              onClick={() => setConfirmingDelete(false)}
              className={PANEL_CONFIRM_CANCEL_CLASS}>
              {CANCEL_LABEL}
            </button>
            <button type='submit' disabled={deletePending} className={PANEL_CONFIRM_DANGER_CLASS}>
              {DELETE_ACTION_BUTTON}
            </button>
          </div>
          {deleteError && (
            <p role='alert' className='mt-2 text-xs text-red-700 dark:text-red-400'>
              {deleteError}
            </p>
          )}
        </form>
      );
    }

    return (
      <div className='flex items-center gap-3'>
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
        <button
          type='button'
          onClick={() => setConfirmingDelete(true)}
          className='rounded-box border border-red-300 bg-surface px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30'>
          {MENU_DELETE}
        </button>
      </div>
    );
  }

  if (confirmingSuspend) {
    return (
      <form
        action={async (formData) => {
          await suspendUserAction({}, formData);
          setConfirmingSuspend(false);
          router.refresh();
        }}
        className='max-w-md rounded-panel border border-zinc-200 bg-surface p-4 dark:border-zinc-800'>
        <input type='hidden' name='id' value={user.id} />
        <p className='text-sm'>
          {user.withdrawalDueAt !== null
            ? SUSPEND_WITHDRAWING_CONFIRMATION_MESSAGE
            : SUSPEND_CONFIRMATION_MESSAGE}
        </p>
        <div className='mt-3 flex justify-end gap-3'>
          <button
            type='button'
            autoFocus
            onClick={() => setConfirmingSuspend(false)}
            className={PANEL_CONFIRM_CANCEL_CLASS}>
            {CANCEL_LABEL}
          </button>
          <button type='submit' className={PANEL_CONFIRM_DANGER_CLASS}>
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
        onClick={() => setConfirmingSuspend(true)}
        className='rounded-box border border-red-300 bg-surface px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30'>
        {MENU_SUSPEND}
      </button>
    </div>
  );
}
