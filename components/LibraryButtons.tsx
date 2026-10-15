'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { setBookmarkAction, setLikeAction } from '@/app/actions/library';

const LABEL_LIKE = 'いいね';
const LABEL_BOOKMARK = 'ブックマーク';
const MESSAGE_SESSION_EXPIRED = 'ログインし直してください';

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox='0 0 24 24'
      className='h-4 w-4 shrink-0'
      fill={filled ? 'currentColor' : 'none'}
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'>
      <path d='M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z' />
    </svg>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox='0 0 24 24'
      className='h-4 w-4 shrink-0'
      fill={filled ? 'currentColor' : 'none'}
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'>
      <path d='m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z' />
    </svg>
  );
}

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
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [liked, setLiked] = useState(initialLiked);
  const [sessionExpired, setSessionExpired] = useState(false);

  const bookmarkSeqRef = useRef(0);
  const likeSeqRef = useRef(0);
  const targetBookmarkedRef = useRef(initialBookmarked);
  const targetLikedRef = useRef(initialLiked);

  const handleBookmark = () => {
    const next = !targetBookmarkedRef.current;
    targetBookmarkedRef.current = next;
    setBookmarked(next);
    setSessionExpired(false);
    const seq = ++bookmarkSeqRef.current;
    void setBookmarkAction(postId, next)
      .then((result) => {
        if (seq !== bookmarkSeqRef.current) return;
        if ('sessionExpired' in result) {
          targetBookmarkedRef.current = !next;
          setBookmarked(!next);
          setSessionExpired(true);
        } else if ('notFound' in result) {
          targetBookmarkedRef.current = !next;
          setBookmarked(!next);
        } else if ('on' in result) {
          targetBookmarkedRef.current = result.on;
          setBookmarked(result.on);
        }
      })
      .catch(() => {
        if (seq !== bookmarkSeqRef.current) return;
        targetBookmarkedRef.current = !next;
        setBookmarked(!next);
      });
  };

  const handleLike = () => {
    if (!canLike) return;
    const next = !targetLikedRef.current;
    targetLikedRef.current = next;
    setLiked(next);
    setSessionExpired(false);
    const seq = ++likeSeqRef.current;
    void setLikeAction(postId, next)
      .then((result) => {
        if (seq !== likeSeqRef.current) return;
        if ('sessionExpired' in result) {
          targetLikedRef.current = !next;
          setLiked(!next);
          setSessionExpired(true);
        } else if ('notFound' in result) {
          targetLikedRef.current = !next;
          setLiked(!next);
        } else if ('on' in result) {
          targetLikedRef.current = result.on;
          setLiked(result.on);
        }
      })
      .catch(() => {
        if (seq !== likeSeqRef.current) return;
        targetLikedRef.current = !next;
        setLiked(!next);
      });
  };

  return (
    <div className='mt-8 flex flex-col items-center gap-2'>
      <div className='flex items-center justify-center gap-3'>
        {canLike && (
          <button
            type='button'
            className='button-library'
            aria-pressed={liked}
            onClick={handleLike}>
            <HeartIcon filled={liked} />
            <span>{LABEL_LIKE}</span>
          </button>
        )}
        <button
          type='button'
          className='button-library'
          aria-pressed={bookmarked}
          onClick={handleBookmark}>
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
