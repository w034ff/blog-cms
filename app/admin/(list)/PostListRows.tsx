import Link from 'next/link';
import type { AdminPost } from '@/lib/posts';
import { categoryLabel, type PostKind } from '@/lib/content';
import { formatPostDate, formatRelativeTime, formatRevisionTime } from '@/lib/format';
import { resolveThumbnail } from '@/lib/thumbnail';
import { PostRowMenu } from './PostRowMenu';
import { HeartIcon } from '@/components/LibraryIcons';
import { accountName } from '@/lib/account-name';

// Two text lines tall, so it keeps the list's rhythm. `object-cover` and a bare `<img>` like every
// other surface (components/PostCard.tsx, globals.css `.link-card-image`,
// components/editor/ThumbnailField.tsx says why), so the preview crops as the cards do.
function AdminThumbnail({ src }: { src: string | null }) {
  if (src === null) {
    return (
      <div className='flex h-9 w-16 shrink-0 items-center justify-center rounded-chip border border-dashed border-zinc-300 text-[10px] text-zinc-400 dark:border-zinc-700'>
        なし
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=''
      className='h-9 w-16 shrink-0 rounded-chip border border-zinc-300 object-cover dark:border-zinc-700'
    />
  );
}

// Renders the rows for both 記事一覧 and 走り書きの一覧 (docs/scribble-requirements.md §6).
// Scribbles omit the thumbnail frame and category (docs/scribble-requirements.md §3.2) and view at
// /scribbles/<slug>.
export function PostListRows({
  posts,
  kind = 'post',
  likesCount,
  showAuthor = false,
}: {
  posts: readonly AdminPost[];
  kind?: PostKind;
  likesCount?: ReadonlyMap<number, number>;
  showAuthor?: boolean;
}) {
  const isScribble = kind === 'scribble';
  const viewHref = (slug: string) => (isScribble ? `/scribbles/${slug}` : `/posts/${slug}`);

  return (
    <ul className='divide-y divide-zinc-200 dark:divide-zinc-800'>
      {posts.map((post) => {
        const likes = likesCount?.get(post.id) ?? 0;
        const author = showAuthor && post.author !== null ? accountName(post.author).name : null;
        return (
          <li key={post.id} className='flex items-center justify-between gap-4 py-3'>
            <div className='flex min-w-0 items-center gap-3'>
              {/* Resolved as every surface does (lib/thumbnail.ts), so this is what a reader
              sees. The slot is always drawn for articles so the titles stay aligned; scribbles omit
              the slot entirely. */}
              {!isScribble && <AdminThumbnail src={resolveThumbnail(post)} />}
              <div className='min-w-0'>
                <Link
                  href={`/admin/posts/${post.id}/edit`}
                  className='line-clamp-2 font-medium hover:underline sm:block sm:truncate'>
                  {/* Only a draft can lack a title; a placeholder keeps it clickable. */}
                  {post.title.trim() ? post.title : <span className='text-zinc-400'>（無題）</span>}
                </Link>
                {/* The state leads the second line rather than trailing the title, so every title
                starts and ends on its own and the badges line up down the list. It wraps on a
                phone rather than cut the category off, and truncates from `sm`. */}
                <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-600 sm:flex-nowrap dark:text-zinc-400'>
                  {post.draft && (
                    <span className='shrink-0 rounded-chip bg-amber-100 px-1.5 leading-4 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'>
                      下書き
                    </span>
                  )}
                  {/* Published rows only: a draft's autosave writes the live columns (lib/posts.ts
                  listAllPosts). Shown here because the author forgets days later, away from the
                  editor. Sky, apart from 下書き's amber. */}
                  {post.hasPendingEdits && (
                    <span className='shrink-0 rounded-chip bg-sky-100 px-1.5 leading-4 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'>
                      未公開の変更
                    </span>
                  )}
                  {/* No slug: a random string (lib/slug.ts) that identifies nothing to a reader of
                  this list. The 表示 link reaches the public URL. */}
                  <span className='min-w-0 sm:truncate'>
                    {author !== null && (
                      <>
                        <span className='whitespace-nowrap'>{author}</span>
                        {' · '}
                      </>
                    )}
                    {/* Relative, since the list is read for how recently a post was touched; the
                      minute is on hover for when it matters. Not 更新: that is the public
                      更新日, a different moment. */}
                    {/* Each part whole, so a phone wraps between them and not inside a date. */}
                    <span className='whitespace-nowrap'>
                      編集{' '}
                      <time
                        dateTime={post.editedAt}
                        title={formatRevisionTime(Date.parse(post.editedAt))}>
                        {formatRelativeTime(Date.parse(post.editedAt))}
                      </time>
                    </span>
                    {post.date && (
                      <>
                        {' · '}
                        <span className='whitespace-nowrap'>公開 {formatPostDate(post.date)}</span>
                      </>
                    )}
                    {!isScribble && (
                      <>
                        {' · '}
                        {post.category ? (
                          <span
                            data-category={post.category}
                            className='category-mark whitespace-nowrap'>
                            {categoryLabel(post.category)}
                          </span>
                        ) : (
                          <span className='whitespace-nowrap'>カテゴリ未設定</span>
                        )}
                      </>
                    )}
                    {likes > 0 && (
                      <>
                        {' · '}
                        <span className='inline-flex items-center gap-1 whitespace-nowrap text-(--accent)'>
                          <HeartIcon filled className='h-3.5 w-3.5' />
                          {likes}
                        </span>
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>
            <div className='flex shrink-0 items-center gap-3'>
              {/* Every row has a slug from creation (lib/db/schema.ts), and a draft's address
              previews for this session, so one 表示 covers both states; the destination's banner
              and the 下書き badge say which. Here rather than in the editor, where it would
              navigate away from it. Below `sm` it moves into ⋯ (PostRowMenu), so the title gets
              the width. */}
              {post.slug && (
                <a
                  href={viewHref(post.slug)}
                  className='hidden text-sm text-zinc-600 hover:underline sm:inline dark:text-zinc-400'>
                  表示
                </a>
              )}
              <PostRowMenu id={post.id} viewHref={post.slug ? viewHref(post.slug) : null} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
