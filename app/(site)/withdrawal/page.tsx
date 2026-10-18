import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { logout } from '@/app/actions/auth';
import { cancelWithdrawalAction } from '@/app/actions/withdrawal';
import { getOptionalSession, getWithdrawingSession } from '@/lib/dal';
import { countAuthoredRows } from '@/lib/withdrawal';
import { withdrawalLastDay } from '@/lib/withdrawal-rules';
import {
  CANCEL_WITHDRAWAL_LABEL,
  formatWithdrawalPageBody,
  LOGOUT_LABEL,
  WITHDRAWAL_TITLE,
} from './constants';

export const metadata: Metadata = { title: WITHDRAWAL_TITLE };

export const dynamic = 'force-dynamic';

// The withdrawal in-progress page (docs/multi-author-requirements.md §12.5).
export default async function WithdrawalPage() {
  const withdrawing = await getWithdrawingSession();
  if (!withdrawing) {
    if (await getOptionalSession()) redirect('/admin');
    redirect('/login');
  }

  const { posts, scribbles } = countAuthoredRows(withdrawing.userId);
  const lastDay = withdrawalLastDay(withdrawing.withdrawalDueAt);

  return (
    <section className='mx-auto w-full max-w-page'>
      <h1 className='mb-6 text-2xl font-bold tracking-tight'>{WITHDRAWAL_TITLE}</h1>
      <div className='flex flex-col gap-6 rounded-panel border border-zinc-200 bg-surface p-5 dark:border-zinc-800'>
        <p className='text-sm leading-relaxed text-zinc-600 dark:text-zinc-400'>
          {formatWithdrawalPageBody(lastDay, posts, scribbles)}
        </p>
        <div className='flex flex-wrap items-center justify-end gap-3'>
          <form action={logout}>
            <button type='submit' className='button-secondary px-4 py-2 text-sm font-medium'>
              {LOGOUT_LABEL}
            </button>
          </form>
          <form action={cancelWithdrawalAction}>
            <button type='submit' className='button-primary px-4 py-2 text-sm font-medium'>
              {CANCEL_WITHDRAWAL_LABEL}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
