import Link from 'next/link';
import type { Post } from '@/lib/types';
import { categoryLabel } from '@/lib/content';
import { formatPostDate, hasVisibleUpdate } from '@/lib/format';
import { resolveThumbnail } from '@/lib/thumbnail';
import { excerptFromBody } from '@/lib/excerpt';

type Props = {
  post: Post;
};

// One post-list row, shared by the home page, /tags/[tag] and /categories/[category]. The text
// column carries the layout and the picture sits beside it at a fixed size: most of this blog's
// posts have no image, so reserving space for one would leave the list full of gaps.
export function PostCard({ post }: Props) {
  // Not `post.thumbnail`: with none chosen, the body's first upload stands in (lib/thumbnail.ts).
  const thumbnail = resolveThumbnail(post);
  // The body's opening, not a field — there is none (lib/excerpt.ts).
  const excerpt = excerptFromBody(post.body);
  return (
    <article className='flex gap-4 border-b border-zinc-200 dark:border-zinc-800 py-6'>
      <div className='min-w-0 flex-1'>
        <Link href={`/posts/${post.slug}`} className='group'>
          <h2 className='text-2xl font-semibold tracking-tight group-hover:underline'>
            {post.title}
          </h2>
        </Link>
        <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400'>
          <time dateTime={post.date}>{formatPostDate(post.date)}</time>
          {hasVisibleUpdate(post.date, post.updatedAt) && (
            <time dateTime={post.updatedAt}>更新: {formatPostDate(post.updatedAt)}</time>
          )}
          <Link
            href={`/categories/${encodeURIComponent(post.category)}`}
            className='hover:underline'>
            {categoryLabel(post.category)}
          </Link>
        </div>
        {/* Clamped by lines, not EXCERPT_MAX_CHARS, which the meta description, og:description
            and RSS share in full. Three lines on a phone, two from `sm`, where the thumbnail
            grows. */}
        {excerpt && (
          <p className='mt-3 line-clamp-3 text-zinc-700 sm:line-clamp-2 dark:text-zinc-300'>
            {excerpt}
          </p>
        )}
        {post.tagList.length > 0 && (
          <ul className='mt-3 flex flex-wrap gap-2'>
            {post.tagList.map(({ slug, name }) => (
              <li key={slug}>
                <Link
                  href={`/tags/${encodeURIComponent(slug)}`}
                  className='inline-block rounded-full bg-surface dark:bg-zinc-800 px-3 py-1 text-xs hover:bg-zinc-200 dark:hover:bg-zinc-700'>
                  #{name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {thumbnail && (
        // Hidden from assistive tech and the tab order: it duplicates the title's link, and an
        // empty-alt second link is a stop that announces nothing.
        <Link
          href={`/posts/${post.slug}`}
          tabIndex={-1}
          aria-hidden='true'
          className='shrink-0 self-start'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbnail}
            alt=''
            className='h-20 w-32 rounded border border-zinc-200 object-cover sm:h-24 sm:w-40 dark:border-zinc-800'
          />
        </Link>
      )}
    </article>
  );
}
