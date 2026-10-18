'use client';

import { useActionState, useId, useState } from 'react';
import { addInviteAction, type UserActionState } from '@/app/actions/users';
import {
  INVITE_BUTTON_LABEL,
  INVITING_BUTTON_LABEL,
  INVITE_LABEL,
  INVITE_PLACEHOLDER,
} from './constants';

const emptyState: UserActionState = {};

export function InviteForm() {
  const [email, setEmail] = useState('');
  const [state, formAction, pending] = useActionState(
    async (prev: UserActionState, formData: FormData) => {
      const result = await addInviteAction(prev, formData);
      if (result.at) {
        setEmail('');
      }
      return result;
    },
    emptyState,
  );
  const id = useId();

  return (
    <form
      noValidate
      action={formAction}
      className='flex flex-col gap-3 rounded-panel border border-zinc-200 bg-surface p-5 dark:border-zinc-800'>
      <label htmlFor={id} className='text-sm font-semibold'>
        {INVITE_LABEL}
      </label>
      <div className='flex gap-3'>
        <input
          id={id}
          type='email'
          name='email'
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={INVITE_PLACEHOLDER}
          className='w-full min-w-0 rounded-box border border-zinc-300 bg-surface px-3 py-2 text-sm focus:ring-2 focus:ring-zinc-400 focus:outline-none dark:border-zinc-700'
        />
        <button
          type='submit'
          disabled={pending}
          className='button-primary shrink-0 px-4 py-2 text-sm font-medium disabled:opacity-40'>
          {pending ? INVITING_BUTTON_LABEL : INVITE_BUTTON_LABEL}
        </button>
      </div>
      {state.error && (
        <p role='alert' className='text-xs text-red-700 dark:text-red-400'>
          {state.error}
        </p>
      )}
    </form>
  );
}
