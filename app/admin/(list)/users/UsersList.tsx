'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Invite } from '@/lib/author-access';
import type { AdminUser } from '@/lib/admin-users';
import { NO_DISPLAY_NAME } from '@/lib/account-name';
import { lookupByEmailAction, type LookupEmailResult } from '@/app/actions/users';
import { UserRowMenu } from './UserRowMenu';
import {
  BADGE_ADMIN,
  BADGE_INVITED,
  BADGE_JOINED_VIA_INVITE,
  BADGE_SUSPENDED,
  CLEAR_SEARCH_LABEL,
  formatAllHistoryLink,
  formatPostCount,
  formatScribbleCount,
  formatSearchResultsCount,
  LOGIN_METHOD_GOOGLE,
  LOGIN_METHOD_PASSWORD,
  NO_SEARCH_RESULTS,
  NOT_LOGGED_IN_YET,
  PREVIOUS_NAMES_PREFIX,
  SEARCH_HELP,
  SEARCH_INPUT_LABEL,
  SEARCH_INPUT_PLACEHOLDER,
} from './constants';

export function UsersList({
  invites,
  users,
}: {
  invites: readonly Invite[];
  users: readonly AdminUser[];
}) {
  const [queryInput, setQueryInput] = useState('');
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<Extract<
    LookupEmailResult,
    { userIds: number[] }
  > | null>(null);
  const [, startTransition] = useTransition();

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = queryInput.trim();
    if (!trimmed) {
      clearSearch();
      return;
    }
    startTransition(async () => {
      const res = await lookupByEmailAction(trimmed);
      if ('userIds' in res) {
        setSearchedQuery(trimmed);
        setSearchResult(res);
      }
    });
  };

  const clearSearch = () => {
    setQueryInput('');
    setSearchedQuery(null);
    setSearchResult(null);
  };

  const displayedUsers =
    searchResult !== null ? users.filter((u) => searchResult.userIds.includes(u.id)) : users;
  const displayedInvites =
    searchResult !== null
      ? invites.filter((i) => searchResult.inviteEmails.includes(i.email))
      : invites;
  const matchedCount = displayedUsers.length + displayedInvites.length;

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-1'>
        <form onSubmit={handleSearch} role='search' className='relative'>
          <svg
            aria-hidden='true'
            viewBox='0 0 16 16'
            className='pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500'>
            <circle cx='7' cy='7' r='4.5' fill='none' stroke='currentColor' strokeWidth='1.5' />
            <path d='M10.5 10.5L14 14' stroke='currentColor' strokeWidth='1.5' />
          </svg>
          <input
            type='search'
            name='email'
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder={SEARCH_INPUT_PLACEHOLDER}
            aria-label={SEARCH_INPUT_LABEL}
            className='w-full rounded-box border border-zinc-300 bg-surface py-2 pr-3 pl-9 text-base focus:ring-2 focus:ring-zinc-400 focus:outline-none dark:border-zinc-700'
          />
          <button type='submit' className='sr-only'>
            {SEARCH_INPUT_LABEL}
          </button>
        </form>
        <p className='text-xs text-zinc-600 dark:text-zinc-400'>{SEARCH_HELP}</p>
      </div>

      {searchedQuery !== null && matchedCount > 0 && (
        <div className='text-sm text-zinc-600 dark:text-zinc-400'>
          <span>{formatSearchResultsCount(searchedQuery, matchedCount)}</span>
          <button
            type='button'
            onClick={clearSearch}
            className='ml-2 underline hover:text-zinc-900 dark:hover:text-zinc-100'>
            {CLEAR_SEARCH_LABEL}
          </button>
        </div>
      )}

      <div className='rounded-panel border border-zinc-200 bg-surface px-4 dark:border-zinc-800'>
        {searchedQuery !== null && matchedCount === 0 ? (
          <p className='py-10 text-center text-sm text-zinc-600 dark:text-zinc-400'>
            {NO_SEARCH_RESULTS}
            <button
              type='button'
              onClick={clearSearch}
              className='ml-2 underline hover:text-zinc-900 dark:hover:text-zinc-100'>
              {CLEAR_SEARCH_LABEL}
            </button>
          </p>
        ) : (
          <ul className='divide-y divide-zinc-200 dark:divide-zinc-800'>
            {displayedInvites.map((invite) => (
              <li
                key={`invite-${invite.email}`}
                className='flex items-center justify-between gap-4 py-3'>
                <div className='flex min-w-0 flex-col gap-1'>
                  <div className='flex items-center gap-2'>
                    <span className='font-medium text-zinc-400'>{NO_DISPLAY_NAME}</span>
                    <span className='shrink-0 rounded-chip bg-sky-100 px-1.5 text-xs leading-4 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'>
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
            {displayedUsers.map((user) => (
              <li key={`user-${user.id}`} className='flex items-center justify-between gap-4 py-3'>
                <div className='flex min-w-0 flex-col gap-1'>
                  <div className='flex items-center gap-2'>
                    <Link href={`/admin/users/${user.id}`} className='font-medium hover:underline'>
                      {user.displayName.trim() ? (
                        user.displayName
                      ) : (
                        <span className='text-zinc-400'>{NO_DISPLAY_NAME}</span>
                      )}
                    </Link>
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
                    {user.joinedVia === 'invite' && (
                      <span className='shrink-0 rounded-chip bg-zinc-100 px-1.5 text-xs leading-4 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'>
                        {BADGE_JOINED_VIA_INVITE}
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
                    <span className='whitespace-nowrap'>
                      {formatScribbleCount(user.scribbleCount)}
                    </span>
                  </div>
                  {user.previousNames.length > 0 && (
                    <div className='flex min-w-0 flex-wrap items-center text-xs text-zinc-500 dark:text-zinc-400'>
                      <span>
                        {PREVIOUS_NAMES_PREFIX}
                        {user.previousNames
                          .map((name) => (name.trim() ? name : NO_DISPLAY_NAME))
                          .join(' → ')}
                        {'・'}
                      </span>
                      <Link href={`/admin/users/${user.id}`} className='hover:underline'>
                        {formatAllHistoryLink(user.historyCount)}
                      </Link>
                    </div>
                  )}
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
        )}
      </div>
    </div>
  );
}
