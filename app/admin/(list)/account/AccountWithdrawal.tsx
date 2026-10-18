'use client';

import { useActionState, useState } from 'react';
import { withdrawAction, type WithdrawalState } from '@/app/actions/withdrawal';
import { WITHDRAWAL_GRACE_DAYS, withdrawalDueAt, withdrawalLastDay } from '@/lib/withdrawal-rules';
import {
  CANCEL_LABEL,
  formatWithdrawalBody,
  formatWithdrawalConfirmationMessage,
  WITHDRAWAL_BUTTON_LABEL,
  WITHDRAWAL_SECTION_HEADING,
} from './constants';
import { PANEL_CONFIRM_CANCEL_CLASS, PANEL_CONFIRM_DANGER_CLASS } from '../panel-confirm';

const initialWithdrawalState: WithdrawalState = {};

// Author withdrawal section in account settings (docs/multi-author-requirements.md §12.5).
export function AccountWithdrawal() {
  const [confirmingDate, setConfirmingDate] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(async () => {
    return await withdrawAction();
  }, initialWithdrawalState);

  const handleOpenConfirm = () => {
    const dueIso = withdrawalDueAt(new Date()).toISOString();
    setConfirmingDate(withdrawalLastDay(dueIso));
  };

  const handleCancelConfirm = () => {
    setConfirmingDate(null);
  };

  return (
    <div className='flex max-w-xl flex-col gap-4 rounded-panel border border-zinc-200 bg-surface p-5 dark:border-zinc-800'>
      <h2 className='text-sm font-semibold'>{WITHDRAWAL_SECTION_HEADING}</h2>
      <p className='text-xs text-zinc-600 dark:text-zinc-400'>
        {formatWithdrawalBody(WITHDRAWAL_GRACE_DAYS)}
      </p>
      {confirmingDate !== null ? (
        <form
          action={formAction}
          className='rounded-box border border-zinc-200 bg-surface p-4 dark:border-zinc-800'>
          <p className='text-sm'>{formatWithdrawalConfirmationMessage(confirmingDate)}</p>
          <div className='mt-3 flex justify-end gap-3'>
            <button
              type='button'
              autoFocus
              onClick={handleCancelConfirm}
              className={PANEL_CONFIRM_CANCEL_CLASS}>
              {CANCEL_LABEL}
            </button>
            <button type='submit' disabled={pending} className={PANEL_CONFIRM_DANGER_CLASS}>
              {WITHDRAWAL_BUTTON_LABEL}
            </button>
          </div>
          {state.error && (
            <p role='alert' className='mt-2 text-xs text-red-700 dark:text-red-400'>
              {state.error}
            </p>
          )}
        </form>
      ) : (
        <div>
          <button
            type='button'
            onClick={handleOpenConfirm}
            className='rounded-box border border-red-300 bg-surface px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30'>
            {WITHDRAWAL_BUTTON_LABEL}
          </button>
        </div>
      )}
    </div>
  );
}
