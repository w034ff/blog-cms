'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { recordViewAction, setBookmarkAction, setLikeAction } from '@/app/actions/library';
import { BookmarkIcon, HeartIcon } from '@/components/LibraryIcons';
import { useMark } from '@/components/useMark';

const LABEL_LIKE = 'いいね';
const LABEL_BOOKMARK = 'ブックマーク';
const MESSAGE_SESSION_EXPIRED = 'ログインし直してください';

// Like and bookmark buttons on a published post or scribble (docs/library-requirements.md §5).
export function LibraryButtons({
  postId,
  initialBookmarked,
  initialLiked,
  canLike,
}: {
  postId: number;
  initialBookmarked: boolean;
  initialLiked: boolean;
  canLike: boolean;
}) {
  const [sessionExpired, setSessionExpired] = useState(false);
  const [bookmarked, toggleBookmark] = useMark(
    postId,
    initialBookmarked,
    setBookmarkAction,
    setSessionExpired,
  );
  const [liked, toggleLike] = useMark(postId, initialLiked, setLikeAction, setSessionExpired);

  useEffect(() => {
    if (canLike) {
      void recordViewAction(postId);
    }
  }, [canLike, postId]);

  return (
    <div className='mt-8 flex flex-col items-center gap-2'>
      <div className='flex items-center justify-center gap-3'>
        {canLike && (
          <button
            type='button'
            className='button-library'
            aria-pressed={liked}
            onClick={toggleLike}>
            <HeartIcon filled={liked} />
            <span>{LABEL_LIKE}</span>
          </button>
        )}
        <button
          type='button'
          className='button-library'
          aria-pressed={bookmarked}
          onClick={toggleBookmark}>
          <BookmarkIcon filled={bookmarked} />
          <span>{LABEL_BOOKMARK}</span>
        </button>
      </div>
      {sessionExpired && (
        <p className='mt-1 text-center text-xs text-zinc-500 dark:text-zinc-400'>
          <Link href='/login' className='text-(--link) underline hover:text-(--link-hover)'>
            {MESSAGE_SESSION_EXPIRED}
          </Link>
        </p>
      )}
    </div>
  );
}
