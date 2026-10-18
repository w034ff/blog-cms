'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getOptionalSession, getWithdrawingSession, WITHDRAWAL_PATH } from '@/lib/dal';
import { cancelWithdrawal, requestWithdrawal } from '@/lib/withdrawal';

// An author's withdrawal and its cancel (docs/multi-author-requirements.md §12.5). Signing out
// from the withdrawal page is app/actions/auth.ts's `logout`, which needs no session check.

export type WithdrawalState = { error?: string };

const ADMIN_CANNOT_WITHDRAW: WithdrawalState = { error: '管理者は退会できません。' };

export async function withdrawAction(): Promise<WithdrawalState> {
  const session = await getOptionalSession();
  if (!session) return { error: 'ログインしていません。' };
  if (requestWithdrawal(session.userId) === null) return ADMIN_CANNOT_WITHDRAW;
  revalidatePath('/', 'layout');
  redirect(WITHDRAWAL_PATH);
}

export async function cancelWithdrawalAction(): Promise<void> {
  const session = await getWithdrawingSession();
  if (!session) redirect('/login');
  cancelWithdrawal(session.userId);
  revalidatePath('/', 'layout');
  redirect('/admin');
}
