'use client';

import { useActionState } from 'react';
import { login, type LoginState } from '@/app/actions/auth';

const initialState: LoginState = {};

const inputClass =
  'w-full rounded-box border border-zinc-300 dark:border-zinc-700 bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400';

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden='true' viewBox='0 0 24 24' className={className}>
      <path
        fill='#4285F4'
        d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'
      />
      <path
        fill='#34A853'
        d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
      />
      <path
        fill='#FBBC05'
        d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z'
      />
      <path
        fill='#EA4335'
        d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z'
      />
    </svg>
  );
}

// Login form (docs/multi-author-requirements.md §9.6) with optional Google sign-in and error banner.
export function LoginForm({
  showGoogle = false,
  errorMessage = null,
}: {
  showGoogle?: boolean;
  errorMessage?: string | null;
}) {
  const [state, action, pending] = useActionState(login, initialState);

  return (
    <div className='max-w-sm space-y-4'>
      {errorMessage && (
        <p role='alert' className='text-sm text-red-600 dark:text-red-400'>
          {errorMessage}
        </p>
      )}
      {showGoogle && (
        <>
          <a
            href='/auth/google'
            className='flex w-full items-center justify-center gap-3 rounded-box border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800'>
            <GoogleIcon className='h-4 w-4' />
            Google でログイン
          </a>
          <div className='flex items-center gap-3 text-xs text-zinc-500'>
            <span className='h-px flex-1 bg-zinc-300 dark:bg-zinc-700' />
            <span>または</span>
            <span className='h-px flex-1 bg-zinc-300 dark:bg-zinc-700' />
          </div>
        </>
      )}
      <form action={action} className='space-y-4'>
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
    </div>
  );
}
