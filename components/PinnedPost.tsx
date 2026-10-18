import Link from 'next/link';
import type { Post } from '@/lib/types';
import { excerptFromBody } from '@/lib/excerpt';
import { resolveThumbnail } from '@/lib/thumbnail';
import { CategoryArt } from '@/components/CategoryArt';
import { PostMeta } from '@/components/PostCard';

export const PINNED_POST_LABEL = 'ピックアップ';

// The post an admin pinned, drawn large above the home page's cards (docs/home-requirements.md §3):
// a 16:9 picture beside the title, the date and category, and three lines of the excerpt. Below `sm`
// the picture is left out, since at 360px it alone would fill most of the first screen (§3).
export function PinnedPost({ post }: { post: Post }) {
  const thumbnail = resolveThumbnail(post);
  const href = `/posts/${post.slug}`;
  // The body's opening, not a field — there is none (lib/excerpt.ts).
  const excerpt = excerptFromBody(post.body);
  return (
    <article className='mb-6 grid overflow-hidden rounded-panel border border-zinc-200 bg-surface md:grid-cols-[3fr_2fr] dark:border-zinc-800'>
      {/* Hidden from assistive tech and the tab order, as the card's picture (components/PostCard.tsx). */}
      <Link href={href} tabIndex={-1} aria-hidden='true' className='hidden sm:block'>
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt='' className='aspect-video h-full w-full object-cover' />
        ) : (
          <CategoryArt className='aspect-video h-full w-full' category={post.category} />
        )}
      </Link>
      <div className='p-5 sm:p-6'>
        <p>
          <span className='tag-chip px-2 py-0.5 text-xs font-semibold'>{PINNED_POST_LABEL}</span>
        </p>
        <Link href={href} className='group'>
          <h2 className='mt-3 text-2xl leading-snug font-bold group-hover:underline'>
            {post.title}
          </h2>
        </Link>
        <PostMeta post={post} className='mt-3' />
        {excerpt && <p className='mt-3 line-clamp-3 text-zinc-700 dark:text-zinc-300'>{excerpt}</p>}
      </div>
    </article>
  );
}
