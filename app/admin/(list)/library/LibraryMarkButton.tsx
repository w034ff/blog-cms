'use client';

import { useState } from 'react';
import { setBookmarkAction, setLikeAction } from '@/app/actions/library';
import {
  ARIA_LABEL_BOOKMARK_REMOVE,
  ARIA_LABEL_BOOKMARK_RESTORE,
  ARIA_LABEL_LIKE_REMOVE,
  ARIA_LABEL_LIKE_RESTORE,
} from './constants';

// The unmark/remark button at the right end of a bookmark or like row (docs/library-requirements.md §6.2).
// Optimistically flips on click, and reverts if the server rejects the write.
export function LibraryMarkButton({ postId, tab }: { postId: number; tab: 'bookmarks' | 'likes' }) {
  const [marked, setMarked] = useState(true);
  const [pending, setPending] = useState(false);

  const isBookmark = tab === 'bookmarks';
  const ariaLabel = isBookmark
    ? marked
      ? ARIA_LABEL_BOOKMARK_REMOVE
      : ARIA_LABEL_BOOKMARK_RESTORE
    : marked
      ? ARIA_LABEL_LIKE_REMOVE
      : ARIA_LABEL_LIKE_RESTORE;

  const handleClick = async () => {
    if (pending) return;
    const next = !marked;
    setMarked(next);
    setPending(true);
    try {
      const action = isBookmark ? setBookmarkAction : setLikeAction;
      const res = await action(postId, next);
      if ('notFound' in res || 'sessionExpired' in res) {
        setMarked(!next);
      }
    } catch {
      setMarked(!next);
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type='button'
      aria-pressed={marked}
      aria-label={ariaLabel}
      onClick={handleClick}
      className='flex h-8 w-8 items-center justify-center rounded-chip text-(--accent) [@media(hover:hover)]:hover:bg-zinc-100 dark:[@media(hover:hover)]:hover:bg-zinc-800'>
      {isBookmark ? (
        <svg
          aria-hidden='true'
          viewBox='0 0 24 24'
          className='h-4.5 w-4.5'
          fill={marked ? 'currentColor' : 'none'}
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'>
          <path d='m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z' />
        </svg>
      ) : (
        <svg
          aria-hidden='true'
          viewBox='0 0 24 24'
          className='h-4.5 w-4.5'
          fill={marked ? 'currentColor' : 'none'}
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'>
          <path d='M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z' />
        </svg>
      )}
    </button>
  );
}
