'use client';

import { useActionState } from 'react';
import { login, type LoginState } from '@/app/actions/auth';

const initialState: LoginState = {};

const inputClass =
  'w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400';

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initialState);

  return (
    <form action={action} className='max-w-sm space-y-4'>
      <div>
        <label htmlFor='username' className='mb-1 block text-sm'>
          ユーザー名
        </label>
        <input id='username' name='username' autoComplete='username' className={inputClass} />
      </div>
      <div>
        <label htmlFor='password' className='mb-1 block text-sm'>
          パスワード
        </label>
        <input
          id='password'
          name='password'
          type='password'
          autoComplete='current-password'
          className={inputClass}
        />
      </div>
      {state.error && <p className='text-sm text-red-600'>{state.error}</p>}
      <button
        type='submit'
        disabled={pending}
        className='button-primary px-4 py-2 text-sm font-medium disabled:pointer-events-none disabled:opacity-50'>
        {pending ? 'ログイン中…' : 'ログイン'}
      </button>
    </form>
  );
}
