'use client';

import { useActionState } from 'react';
import { pinPostAction, type PinPostState } from '@/app/actions/settings';

// The same action as the list's ⋯ (app/admin/(list)/PostRowMenu.tsx); an empty id takes the pin off.
// No confirmation: the ⋯ pins it again in two clicks, and the box turning to なし says it worked.
export function UnpinButton() {
  const [state, action, pending] = useActionState<PinPostState, FormData>(pinPostAction, {});
  return (
    <form action={action} className='flex flex-col gap-1.5'>
      <input type='hidden' name='id' value='' />
      <button
        type='submit'
        disabled={pending}
        className='rounded-box border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800'>
        固定を外す
      </button>
      {state.error && (
        <p role='alert' className='text-xs text-red-700 dark:text-red-400'>
          {state.error}
        </p>
      )}
    </form>
  );
}
