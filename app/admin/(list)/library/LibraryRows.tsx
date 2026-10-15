import Link from 'next/link';
import type { LibraryTab } from '@/lib/admin-post-list';
import { formatPostDate, formatRelativeTime } from '@/lib/format';
import type { LibraryEntry } from '@/lib/library';
import { AT_PREFIXES, KIND_LABEL_POST, KIND_LABEL_SCRIBBLE } from './constants';
import { LibraryMarkButton } from './LibraryMarkButton';

// The rows of a library tab (docs/library-requirements.md §6.2), linking to public post pages.
export function LibraryRows({
  entries,
  tab,
}: {
  entries: readonly LibraryEntry[];
  tab: LibraryTab;
}) {
  const atPrefix = AT_PREFIXES[tab];

  return (
    <ul className='divide-y divide-zinc-200 dark:divide-zinc-800'>
      {entries.map((entry) => {
        const viewHref = entry.slug
          ? entry.kind === 'scribble'
            ? `/scribbles/${entry.slug}`
            : `/posts/${entry.slug}`
          : '#';

        return (
          <li key={entry.postId} className='flex items-center justify-between gap-4 py-3'>
            <div className='flex min-w-0 items-center gap-3'>
              <div className='min-w-0'>
                <Link
                  href={viewHref}
                  className='line-clamp-2 font-medium hover:underline sm:block sm:truncate'>
                  {entry.title.trim() ? (
                    entry.title
                  ) : (
                    <span className='text-zinc-400'>（無題）</span>
                  )}
                </Link>
                <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-600 sm:flex-nowrap dark:text-zinc-400'>
                  {entry.kind === 'scribble' ? (
                    <span className='shrink-0 rounded-chip bg-(--chip-bg) px-1.5 leading-4 text-(--chip-fg)'>
                      {KIND_LABEL_SCRIBBLE}
                    </span>
                  ) : (
                    <span className='shrink-0 rounded-chip bg-zinc-100 px-1.5 leading-4 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'>
                      {KIND_LABEL_POST}
                    </span>
                  )}
                  <span className='min-w-0 sm:truncate'>
                    <span className='whitespace-nowrap'>
                      {atPrefix}
                      <time dateTime={new Date(entry.at).toISOString()}>
                        {formatRelativeTime(entry.at)}
                      </time>
                    </span>
                    {entry.date && (
                      <>
                        {' · '}
                        <span className='whitespace-nowrap'>公開 {formatPostDate(entry.date)}</span>
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>
            {tab !== 'history' && (
              <div className='flex shrink-0 items-center'>
                <LibraryMarkButton postId={entry.postId} tab={tab} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
