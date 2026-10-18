import Link from 'next/link';
import type { Post } from '@/lib/types';
import { categoryLabel } from '@/lib/content';
import { formatPostDate } from '@/lib/format';
import { resolveThumbnail } from '@/lib/thumbnail';
import { PINNED_POST_LABEL } from '@/components/PinnedPost';
import { AdminThumbnail } from '../PostListRows';
import { UnpinButton } from './UnpinButton';

export const PICKUP_HELP =
  'トップの 1 ページ目に大きく出す記事です。記事一覧の各行の「⋯」から選びます。';
export const PICKUP_NONE = 'なし';

// The pin, shown where an admin looks for the site's own values (docs/site-settings-requirements.md
// §10): it is stored beside them in `app_settings`, and the ⋯ that sets it says nothing until opened.
// A box of its own, apart from 保存, since unpinning takes effect at once. `post` is what the home
// page would draw (lib/post-list.ts `splitPinned`), so a saved id whose post is no longer listed
// reads なし here as the slot is empty there.
export function PickupPanel({ post }: { post: Post | null }) {
  return (
    <section
      aria-labelledby='pickup-label'
      className='mt-6 flex max-w-xl flex-col gap-1.5 rounded-panel border border-zinc-200 bg-surface p-5 dark:border-zinc-800'>
      <h2 id='pickup-label' className='text-sm font-semibold'>
        {PINNED_POST_LABEL}
      </h2>
      <p className='text-xs text-zinc-600 dark:text-zinc-400'>{PICKUP_HELP}</p>
      {post === null ? (
        <p className='text-sm text-zinc-600 dark:text-zinc-400'>{PICKUP_NONE}</p>
      ) : (
        <div className='mt-1 flex flex-col items-start gap-3'>
          <div className='flex min-w-0 items-center gap-3'>
            <AdminThumbnail src={resolveThumbnail(post)} />
            <div className='min-w-0'>
              <Link
                href={`/admin/posts/${post.id}/edit`}
                className='line-clamp-2 text-sm font-medium hover:underline'>
                {post.title}
              </Link>
              <p className='text-xs text-zinc-600 dark:text-zinc-400'>
                公開 {formatPostDate(post.date)}
                {' · '}
                <span data-category={post.category} className='category-mark whitespace-nowrap'>
                  {categoryLabel(post.category)}
                </span>
              </p>
            </div>
          </div>
          <UnpinButton />
        </div>
      )}
    </section>
  );
}
