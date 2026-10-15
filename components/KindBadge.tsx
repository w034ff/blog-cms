import type { PostKind } from '@/lib/content';

export const KIND_BADGE_POST_LABEL = '記事';
export const KIND_BADGE_SCRIBBLE_LABEL = '走り書き';

// Kind badge for posts and scribbles, matching the library styling (docs/library-requirements.md §6.2, docs/search-requirements.md §4).
export function KindBadge({ kind }: { kind: PostKind }) {
  if (kind === 'scribble') {
    return (
      <span className='shrink-0 rounded-chip bg-(--chip-bg) px-1.5 leading-4 text-(--chip-fg)'>
        {KIND_BADGE_SCRIBBLE_LABEL}
      </span>
    );
  }
  return (
    <span className='shrink-0 rounded-chip bg-zinc-100 px-1.5 leading-4 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'>
      {KIND_BADGE_POST_LABEL}
    </span>
  );
}
