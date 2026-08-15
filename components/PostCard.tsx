import Link from 'next/link';
import type { Post } from '@/lib/types';
import { formatPostDate } from '@/lib/format';
import { resolveThumbnail } from '@/lib/thumbnail';

type Props = {
  post: Post;
};

// One row of the post list, shared by the home page, /tags/[tag] and
// /categories/[category] — a layout change here lands on all three at once.
//
// The image is optional and the row is built so that its absence is not a hole:
// the text column is what carries the layout, and the picture sits beside it at
// a fixed size. Most of this blog's posts have no image, so a design that
// reserved space for one would leave the list full of gaps.
export function PostCard({ post }: Props) {
  // Not `post.thumbnail`: an author who chose no image still gets the body's
  // first upload, which is what makes the existing archive show pictures without
  // anyone re-editing it (lib/thumbnail.ts).
  const thumbnail = resolveThumbnail(post);
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
          <Link
            href={`/categories/${encodeURIComponent(post.category)}`}
            className='hover:underline'>
            {post.category}
          </Link>
        </div>
        {post.description && (
          <p className='mt-3 text-zinc-700 dark:text-zinc-300'>{post.description}</p>
        )}
        {post.tags.length > 0 && (
          <ul className='mt-3 flex flex-wrap gap-2'>
            {post.tags.map((tag) => (
              <li key={tag}>
                <Link
                  href={`/tags/${encodeURIComponent(tag)}`}
                  className='inline-block rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-1 text-xs hover:bg-zinc-200 dark:hover:bg-zinc-700'>
                  #{tag}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {thumbnail && (
        // Hidden from assistive technology and excluded from the tab order: it
        // links to the same place as the title directly above it, and an empty
        // alt on a second link to one destination is a duplicate stop that
        // announces nothing. The picture is decoration on a row whose text is
        // already complete.
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
