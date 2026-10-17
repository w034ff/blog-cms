import Link from 'next/link';
import type { Post } from '@/lib/types';
import { categoryLabel } from '@/lib/content';
import { formatPostDate, hasVisibleUpdate } from '@/lib/format';
import { resolveThumbnail } from '@/lib/thumbnail';
import { excerptFromBody } from '@/lib/excerpt';
import { CategoryArt } from '@/components/CategoryArt';

// The thumbnail's frame, shared by a photo and the mark: 128×80, 160×96 from `sm`
// (docs/category-mark-requirements.md §3.2).
const THUMBNAIL_FRAME = 'h-20 w-32 rounded-chip border sm:h-24 sm:w-40';

type Props = {
  post: Post;
};

// One post-list row, shared by the home page, /tags/[tag] and /categories/[category]. The text
// column carries the layout and the picture sits beside it at a fixed size, the same frame for a
// photo and for the category-coloured mark a post without one gets, so every row is the same shape
// (docs/category-mark-requirements.md §2). Below `sm` the excerpt and tags are hidden, not removed
// from the HTML, so the narrow column stays level with the picture (§5).
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
        <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400'>
          <time dateTime={post.date}>{formatPostDate(post.date)}</time>
          {hasVisibleUpdate(post.date, post.updatedAt) && (
            <time dateTime={post.updatedAt}>更新: {formatPostDate(post.updatedAt)}</time>
          )}
          <Link
            href={`/categories/${encodeURIComponent(post.category)}`}
            data-category={post.category}
            className='category-mark hover:underline'>
            {categoryLabel(post.category)}
          </Link>
        </div>
        {/* Clamped by lines, not EXCERPT_MAX_CHARS, which the meta description, og:description
            and RSS share in full. Shown from `sm`, two lines. */}
        {excerpt && (
          <p className='mt-3 hidden text-zinc-700 sm:line-clamp-2 sm:block dark:text-zinc-300'>
            {excerpt}
          </p>
        )}
        {post.tagList.length > 0 && (
          <ul className='mt-3 hidden flex-wrap gap-2 sm:flex'>
            {post.tagList.map(({ slug, name }) => (
              <li key={slug}>
                <Link
                  href={`/tags/${encodeURIComponent(slug)}`}
                  className='tag-chip px-3 py-1 text-xs'>
                  #{name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* Hidden from assistive tech and the tab order: it duplicates the title's link, and an
          empty-alt second link is a stop that announces nothing. */}
      <Link
        href={`/posts/${post.slug}`}
        tabIndex={-1}
        aria-hidden='true'
        className='shrink-0 self-start'>
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
    </article>
  );
}
