import Link from 'next/link';
import type { Post } from '@/lib/types';
import { categoryLabel } from '@/lib/content';
import { formatPostDate } from '@/lib/format';
import { resolveThumbnail } from '@/lib/thumbnail';
import { CategoryArt } from '@/components/CategoryArt';

// The picture's frame, the same for a photo and the mark: a 72px square
// (docs/category-mark-requirements.md §3.2).
const THUMBNAIL_FRAME = 'h-18 w-18 shrink-0 rounded-box border';

type Props = {
  post: Post;
};

// One card of the post lists — the home page, /categories/[category] and /tags/[tag] — laid out two
// to a row by PostCardGrid. Title, date and category beside a square picture, and nothing else: no
// excerpt and no tags, which is what fits twice the posts on a screen (docs/home-requirements.md §2).
// The picture is a photo when the post has one and the category-coloured mark otherwise, in the same
// frame, so every card is the same shape (docs/category-mark-requirements.md §2).
export function PostCard({ post }: Props) {
  // Not `post.thumbnail`: with none chosen, the body's first upload stands in (lib/thumbnail.ts).
  const thumbnail = resolveThumbnail(post);
  const href = `/posts/${post.slug}`;
  return (
    <article className='flex gap-4 rounded-panel border border-zinc-200 bg-surface p-4 dark:border-zinc-800'>
      {/* Hidden from assistive tech and the tab order: it duplicates the title's link, and an
          empty-alt second link is a stop that announces nothing. */}
      <Link href={href} tabIndex={-1} aria-hidden='true' className='shrink-0 self-start'>
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt=''
            className={`${THUMBNAIL_FRAME} border-zinc-200 object-cover dark:border-zinc-800`}
          />
        ) : (
          <CategoryArt
            className={`${THUMBNAIL_FRAME} post-thumbnail-art`}
            category={post.category}
          />
        )}
      </Link>
      <div className='min-w-0'>
        <Link href={href} className='group'>
          <h2 className='line-clamp-3 leading-snug font-bold group-hover:underline'>
            {post.title}
          </h2>
        </Link>
        <PostMeta post={post} className='mt-2' />
      </div>
    </article>
  );
}

// The date and the category, shared by the card and the pinned post (components/PinnedPost.tsx).
export function PostMeta({ post, className }: { post: Post; className: string }) {
  return (
    <div
      className={`${className} flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400`}>
      <time dateTime={post.date}>{formatPostDate(post.date)}</time>
      <Link
        href={`/categories/${encodeURIComponent(post.category)}`}
        data-category={post.category}
        className='category-mark hover:underline'>
        {categoryLabel(post.category)}
      </Link>
    </div>
  );
}

// The two-column grid every post list draws its cards in; one column below `md`.
export function PostCardGrid({ posts }: { posts: readonly Post[] }) {
  return (
    <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
      {posts.map((post) => (
        <PostCard key={post.slug} post={post} />
      ))}
    </div>
  );
}
