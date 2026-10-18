import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { verifyAdmin } from '@/lib/dal';
import { getUserDetail } from '@/lib/admin-users';
import { accountName, NO_DISPLAY_NAME } from '@/lib/account-name';
import { formatPostDate, formatRevisionTime } from '@/lib/format';
import { withdrawalLastDay } from '@/lib/withdrawal-rules';
import {
  BACK_TO_USERS,
  BADGE_ADMIN,
  BADGE_JOINED_VIA_INVITE,
  BADGE_SUSPENDED,
  BADGE_WITHDRAWING,
  CURRENT_DISPLAY_NAME_LABEL,
  formatRegisteredDate,
  formatWithdrawalPurgeNotice,
  HISTORY_HEADING,
  LOGIN_METHOD_GOOGLE,
  LOGIN_METHOD_PASSWORD,
} from '../constants';
import { UserDetailSuspend } from './UserDetailSuspend';
import { UserDetailPosts } from './UserDetailPosts';

type Props = {
  params: Promise<{ id: string }>;
};

export const dynamic = 'force-dynamic';

// User detail screen (/admin/users/<id>, docs/multi-author-requirements.md §10.6).
// Admins only; non-admins and missing accounts get a 404.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await verifyAdmin();
  const { id: rawId } = await params;
  const id = Number(rawId);
  const user = getUserDetail(id);
  if (!user) notFound();
  return {
    title: accountName(user).name,
  };
}

export default async function UserDetailPage({ params }: Props) {
  await verifyAdmin();
  const { id: rawId } = await params;
  const id = Number(rawId);
  const user = getUserDetail(id);
  if (!user) notFound();

  return (
    <section>
      <div className='flex flex-col gap-6'>
        <div>
          <Link
            href='/admin/users'
            className='text-sm text-zinc-600 hover:underline dark:text-zinc-400'>
            {BACK_TO_USERS}
          </Link>
        </div>

        <div className='flex flex-col gap-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <h1 className='text-2xl font-bold tracking-tight [overflow-wrap:anywhere]'>
              {user.displayName.trim() ? (
                user.displayName
              ) : (
                <span className='text-zinc-400'>{NO_DISPLAY_NAME}</span>
              )}
            </h1>
            {user.role === 'admin' && (
              <span className='shrink-0 rounded-chip bg-violet-100 px-1.5 text-xs leading-4 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300'>
                {BADGE_ADMIN}
              </span>
            )}
            {user.suspendedAt !== null && (
              <span className='shrink-0 rounded-chip bg-red-100 px-1.5 text-xs leading-4 text-red-800 dark:bg-red-900/40 dark:text-red-300'>
                {BADGE_SUSPENDED}
              </span>
            )}
            {user.withdrawalDueAt !== null && (
              <span className='shrink-0 rounded-chip bg-red-100 px-1.5 text-xs leading-4 text-red-800 dark:bg-red-900/40 dark:text-red-300'>
                {BADGE_WITHDRAWING}
              </span>
            )}
          </div>
          <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-600 dark:text-zinc-400'>
            <span className='whitespace-nowrap'>
              {user.isGoogle ? LOGIN_METHOD_GOOGLE : LOGIN_METHOD_PASSWORD}
            </span>
            {user.joinedVia === 'invite' && (
              <>
                <span>·</span>
                <span className='whitespace-nowrap'>{BADGE_JOINED_VIA_INVITE}</span>
              </>
            )}
            {user.createdAt && (
              <>
                <span>·</span>
                <span className='whitespace-nowrap'>
                  {formatRegisteredDate(formatPostDate(user.createdAt))}
                </span>
              </>
            )}
            {user.withdrawalDueAt !== null && (
              <>
                <span>·</span>
                <span className='whitespace-nowrap'>
                  {formatWithdrawalPurgeNotice(withdrawalLastDay(user.withdrawalDueAt))}
                </span>
              </>
            )}
          </div>
        </div>

        <UserDetailSuspend
          user={user}
          postCount={user.posts.post.total}
          scribbleCount={user.posts.scribble.total}
        />

        <div className='flex flex-col gap-3 rounded-panel border border-zinc-200 bg-surface p-5 dark:border-zinc-800'>
          <h2 className='text-sm font-semibold'>{HISTORY_HEADING}</h2>
          <ul className='divide-y divide-zinc-200 text-sm dark:divide-zinc-800'>
            {user.history.length === 0 ? (
              <li className='flex items-center justify-between gap-4 py-2'>
                <div className='flex min-w-0 flex-wrap items-center gap-2'>
                  <span
                    className={`[overflow-wrap:anywhere] ${!user.displayName.trim() ? 'text-zinc-400' : ''}`}>
                    {user.displayName.trim() ? user.displayName : NO_DISPLAY_NAME}
                  </span>
                  <span className='shrink-0 rounded-chip bg-zinc-100 px-1.5 text-xs leading-4 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'>
                    {CURRENT_DISPLAY_NAME_LABEL}
                  </span>
                </div>
              </li>
            ) : (
              user.history.map((row, index) => (
                <li
                  key={`${row.displayName}-${row.changedAt}-${index}`}
                  className='flex items-start justify-between gap-4 py-2'>
                  <div className='flex min-w-0 flex-1 flex-wrap items-center gap-2'>
                    <span
                      className={`[overflow-wrap:anywhere] ${!row.displayName.trim() ? 'text-zinc-400' : ''}`}>
                      {row.displayName.trim() ? row.displayName : NO_DISPLAY_NAME}
                    </span>
                    {index === 0 && (
                      <span className='shrink-0 rounded-chip bg-zinc-100 px-1.5 text-xs leading-4 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'>
                        {CURRENT_DISPLAY_NAME_LABEL}
                      </span>
                    )}
                  </div>
                  <span className='shrink-0 text-xs text-zinc-500 whitespace-nowrap dark:text-zinc-400'>
                    {formatRevisionTime(Date.parse(row.changedAt))}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>

        <UserDetailPosts posts={user.posts} />
      </div>
    </section>
  );
}
