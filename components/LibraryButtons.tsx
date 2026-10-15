'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  type MarkResult,
  recordViewAction,
  setBookmarkAction,
  setLikeAction,
} from '@/app/actions/library';

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

function useMark(
  postId: number,
  initial: boolean,
  action: (postId: unknown, on: unknown) => Promise<MarkResult>,
  setSessionExpired: (expired: boolean) => void,
): [marked: boolean, toggle: () => void] {
  const [marked, setMarked] = useState(initial);
  const targetRef = useRef(initial);
  const seqRef = useRef(0);

  const toggle = () => {
    const next = !targetRef.current;
    targetRef.current = next;
    setMarked(next);
    setSessionExpired(false);
    const seq = ++seqRef.current;
    void action(postId, next)
      .then((result) => {
        if (seq !== seqRef.current) return;
        if ('sessionExpired' in result) {
          targetRef.current = !next;
          setMarked(!next);
          setSessionExpired(true);
        } else if ('notFound' in result) {
          targetRef.current = !next;
          setMarked(!next);
        } else if ('on' in result) {
          targetRef.current = result.on;
          setMarked(result.on);
        }
      })
      .catch(() => {
        if (seq !== seqRef.current) return;
        targetRef.current = !next;
        setMarked(!next);
      });
  };

  return [marked, toggle];
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
