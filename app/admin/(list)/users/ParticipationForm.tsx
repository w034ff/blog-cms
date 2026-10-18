'use client';

import { useActionState, useState } from 'react';
import { saveAuthorAccessModeAction, type UserActionState } from '@/app/actions/users';
import type { AuthorAccessMode } from '@/lib/author-access-rules';
import {
  ACCESS_MODE_ALLOWLIST_HELP,
  ACCESS_MODE_ALLOWLIST_LABEL,
  ACCESS_MODE_OPEN_HELP,
  ACCESS_MODE_OPEN_LABEL,
  PARTICIPATION_HEADING,
  SAVED_MESSAGE,
  SAVE_LABEL,
  SAVING_LABEL,
} from './constants';

const emptyState: UserActionState = {};

export function ParticipationForm({ initialMode }: { initialMode: AuthorAccessMode }) {
  const [state, formAction, pending] = useActionState(saveAuthorAccessModeAction, emptyState);
  const [mode, setMode] = useState<AuthorAccessMode>(initialMode);

  return (
    <form
      action={formAction}
      className='flex flex-col gap-4 rounded-panel border border-zinc-200 bg-surface p-5 dark:border-zinc-800'>
      <h2 className='text-base font-semibold'>{PARTICIPATION_HEADING}</h2>
      {state.error && (
        <p role='alert' className='text-xs text-red-700 dark:text-red-400'>
          {state.error}
        </p>
      )}
      <div className='flex flex-col gap-3'>
        <label className='flex cursor-pointer items-start gap-3'>
          <input
            type='radio'
            name='mode'
            value='allowlist'
            checked={mode === 'allowlist'}
            onChange={() => setMode('allowlist')}
            className='mt-1'
          />
          <div className='flex flex-col gap-0.5 text-sm'>
            <span className='font-medium'>{ACCESS_MODE_ALLOWLIST_LABEL}</span>
            <span className='text-xs text-zinc-600 dark:text-zinc-400'>
              {ACCESS_MODE_ALLOWLIST_HELP}
            </span>
          </div>
        </label>
        <label className='flex cursor-pointer items-start gap-3'>
          <input
            type='radio'
            name='mode'
            value='open'
            checked={mode === 'open'}
            onChange={() => setMode('open')}
            className='mt-1'
          />
          <div className='flex flex-col gap-0.5 text-sm'>
            <span className='font-medium'>{ACCESS_MODE_OPEN_LABEL}</span>
            <span className='text-xs text-zinc-600 dark:text-zinc-400'>
              {ACCESS_MODE_OPEN_HELP}
            </span>
          </div>
        </label>
      </div>
      <div className='flex items-center justify-between pt-1'>
        {state.at && !pending ? (
          <p role='status' className='flex items-center gap-1.5 text-sm'>
            <svg aria-hidden='true' viewBox='0 0 16 16' className='h-4 w-4 text-(--good)'>
              <path
                d='M3 8.5l3 3 7-7'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
            {SAVED_MESSAGE}
          </p>
        ) : (
          <span />
        )}
        <button
          type='submit'
          disabled={pending}
          className='button-primary px-4 py-2 text-sm font-medium disabled:opacity-40'>
          {pending ? SAVING_LABEL : SAVE_LABEL}
        </button>
      </div>
    </form>
  );
}
