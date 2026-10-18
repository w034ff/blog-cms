import type { Invite } from '@/lib/author-access';
import type { AdminUser } from '@/lib/admin-users';
import { NO_DISPLAY_NAME } from '@/lib/account-name';
import { UserRowMenu } from './UserRowMenu';
import {
  BADGE_ADMIN,
  BADGE_INVITED,
  BADGE_SUSPENDED,
  formatPostCount,
  formatScribbleCount,
  LOGIN_METHOD_GOOGLE,
  LOGIN_METHOD_PASSWORD,
  NOT_LOGGED_IN_YET,
} from './constants';

export function UsersList({
  invites,
  users,
}: {
  invites: readonly Invite[];
  users: readonly AdminUser[];
}) {
  return (
    <div className='rounded-panel border border-zinc-200 bg-surface px-4 dark:border-zinc-800'>
      <ul className='divide-y divide-zinc-200 dark:divide-zinc-800'>
        {invites.map((invite) => (
          <li
            key={`invite-${invite.email}`}
            className='flex items-center justify-between gap-4 py-3'>
            <div className='flex min-w-0 flex-col gap-1'>
              <div className='flex items-center gap-2'>
                <span className='font-medium text-zinc-400'>{NO_DISPLAY_NAME}</span>
                <span className='shrink-0 rounded-chip bg-sky-100 px-1.5 leading-4 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'>
                  {BADGE_INVITED}
                </span>
              </div>
              <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-600 dark:text-zinc-400'>
                <span className='break-all'>{invite.email}</span>
                {' · '}
                <span className='whitespace-nowrap'>{NOT_LOGGED_IN_YET}</span>
              </div>
            </div>
            <div className='flex shrink-0 items-center'>
              <UserRowMenu target={{ type: 'invite', email: invite.email }} />
            </div>
          </li>
        ))}
        {users.map((user) => (
          <li key={`user-${user.id}`} className='flex items-center justify-between gap-4 py-3'>
            <div className='flex min-w-0 flex-col gap-1'>
              <div className='flex items-center gap-2'>
                <span className='font-medium'>
                  {user.displayName.trim() ? (
                    user.displayName
                  ) : (
                    <span className='text-zinc-400'>{NO_DISPLAY_NAME}</span>
                  )}
                </span>
                {user.role === 'admin' && (
                  <span className='shrink-0 rounded-chip bg-violet-100 px-1.5 leading-4 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300'>
                    {BADGE_ADMIN}
                  </span>
                )}
                {user.suspendedAt !== null && (
                  <span className='shrink-0 rounded-chip bg-red-100 px-1.5 leading-4 text-red-800 dark:bg-red-900/40 dark:text-red-300'>
                    {BADGE_SUSPENDED}
                  </span>
                )}
              </div>
              <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-600 sm:flex-nowrap dark:text-zinc-400'>
                <span className='whitespace-nowrap'>
                  {user.isGoogle ? LOGIN_METHOD_GOOGLE : LOGIN_METHOD_PASSWORD}
                </span>
                {' · '}
                <span className='whitespace-nowrap'>{formatPostCount(user.postCount)}</span>
                {' · '}
                <span className='whitespace-nowrap'>{formatScribbleCount(user.scribbleCount)}</span>
              </div>
            </div>
            <div className='flex shrink-0 items-center'>
              <UserRowMenu
                target={{
                  type: 'user',
                  id: user.id,
                  role: user.role,
                  suspended: user.suspendedAt !== null,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
