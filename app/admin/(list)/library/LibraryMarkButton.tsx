'use client';

import { setBookmarkAction, setLikeAction } from '@/app/actions/library';
import { BookmarkIcon, HeartIcon } from '@/components/LibraryIcons';
import { useMark } from '@/components/useMark';
import {
  ARIA_LABEL_BOOKMARK_REMOVE,
  ARIA_LABEL_BOOKMARK_RESTORE,
  ARIA_LABEL_LIKE_REMOVE,
  ARIA_LABEL_LIKE_RESTORE,
} from './constants';

// The unmark/remark button at the right end of a bookmark or like row (docs/library-requirements.md
// §6.2). An unmarked row stays until the page is opened again, so the same button puts it back.
export function LibraryMarkButton({ postId, tab }: { postId: number; tab: 'bookmarks' | 'likes' }) {
  const isBookmark = tab === 'bookmarks';
  const [marked, toggle] = useMark(postId, true, isBookmark ? setBookmarkAction : setLikeAction);
  const ariaLabel = isBookmark
    ? marked
      ? ARIA_LABEL_BOOKMARK_REMOVE
      : ARIA_LABEL_BOOKMARK_RESTORE
    : marked
      ? ARIA_LABEL_LIKE_REMOVE
      : ARIA_LABEL_LIKE_RESTORE;
  const Icon = isBookmark ? BookmarkIcon : HeartIcon;

  return (
    <button
      type='button'
      aria-pressed={marked}
      aria-label={ariaLabel}
      onClick={toggle}
      className='flex h-8 w-8 items-center justify-center rounded-chip text-(--accent) [@media(hover:hover)]:hover:bg-zinc-100 dark:[@media(hover:hover)]:hover:bg-zinc-800'>
      <Icon filled={marked} className='h-4.5 w-4.5' />
    </button>
  );
}
