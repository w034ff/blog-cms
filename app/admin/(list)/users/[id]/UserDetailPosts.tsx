'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { UserDetailPost } from '@/lib/admin-users';
import type { PostKind } from '@/lib/content';
import { formatPostDate } from '@/lib/format';
import {
  DRAFT_BADGE,
  formatArticlesTab,
  formatRemainingCount,
  formatScribblesTab,
  NO_WRITINGS_MESSAGE,
  UNTITLED_POST,
  WRITINGS_HEADING,
} from '../constants';

// Tabbed display of articles and scribbles authored by an account (docs/multi-author-requirements.md §10.6).
export function UserDetailPosts({
  posts,
}: {
  posts: Record<PostKind, { total: number; rows: UserDetailPost[] }>;
}) {
  const [activeTab, setActiveTab] = useState<'post' | 'scribble'>('post');
  const currentData = posts[activeTab];
  const remaining = currentData.total - currentData.rows.length;

  return (
    <div className='flex flex-col gap-4 rounded-panel border border-zinc-200 bg-surface p-5 dark:border-zinc-800'>
      <h2 className='text-sm font-semibold'>{WRITINGS_HEADING}</h2>

      <div className='border-b border-zinc-200 dark:border-zinc-800'>
        <div className='-mb-px flex gap-4'>
          <button
            type='button'
            onClick={() => setActiveTab('post')}
            className={`border-b-2 py-2 text-sm font-medium ${
              activeTab === 'post'
                ? 'border-(--accent) text-zinc-900 dark:text-zinc-50'
                : 'border-transparent text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50'
            }`}>
            {formatArticlesTab(posts.post.total)}
          </button>
          <button
            type='button'
            onClick={() => setActiveTab('scribble')}
            className={`border-b-2 py-2 text-sm font-medium ${
              activeTab === 'scribble'
                ? 'border-(--accent) text-zinc-900 dark:text-zinc-50'
                : 'border-transparent text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50'
            }`}>
            {formatScribblesTab(posts.scribble.total)}
          </button>
        </div>
      </div>

      {currentData.total === 0 ? (
        <p className='py-6 text-center text-sm text-zinc-600 dark:text-zinc-400'>
          {NO_WRITINGS_MESSAGE}
        </p>
      ) : (
        <div className='flex flex-col gap-3'>
          <ul className='divide-y divide-zinc-200 text-sm dark:divide-zinc-800'>
            {currentData.rows.map((row) => (
              <li key={row.id} className='flex items-center justify-between gap-4 py-2.5'>
                <div className='flex min-w-0 items-center gap-2'>
                  <Link href={`/admin/posts/${row.id}/edit`} className='truncate hover:underline'>
                    {row.title.trim() ? (
                      row.title
                    ) : (
                      <span className='text-zinc-400'>{UNTITLED_POST}</span>
                    )}
                  </Link>
                  {row.draft && (
                    <span className='shrink-0 rounded-chip bg-amber-100 px-1.5 text-xs leading-4 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'>
                      {DRAFT_BADGE}
                    </span>
                  )}
                </div>
                <span className='shrink-0 text-xs text-zinc-500 dark:text-zinc-400'>
                  {formatPostDate(row.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          {remaining > 0 && (
            <p className='text-center text-xs text-zinc-500 dark:text-zinc-400'>
              {formatRemainingCount(remaining)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
