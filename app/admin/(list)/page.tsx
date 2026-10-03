import Link from 'next/link';
import { listAllPosts } from '@/lib/posts';
import { isAdmin } from '@/lib/dal';
import { categoryLabel } from '@/lib/content';
import { formatPostDate, formatRelativeTime, formatRevisionTime } from '@/lib/format';
import { resolveThumbnail } from '@/lib/thumbnail';
import {
  countByStatus,
  matchesStatus,
  narrow,
  parseListParams,
  sortPosts,
} from '@/lib/admin-post-list';
import { EmptyPostList } from './EmptyPostList';
import { ListControls } from './ListControls';
import { ScreenHeading } from './ScreenHeading';
import { PostRowMenu } from './PostRowMenu';

export const dynamic = 'force-dynamic';

// Two text lines tall, so it keeps the list's rhythm. `object-cover` and a bare `<img>` like every
// other surface (components/PostCard.tsx, globals.css `.link-card-image`,
// components/editor/ThumbnailField.tsx says why), so the preview crops as the cards do.
function AdminThumbnail({ src }: { src: string | null }) {
  if (src === null) {
    return (
      <div className='flex h-9 w-16 shrink-0 items-center justify-center rounded border border-dashed border-zinc-300 text-[10px] text-zinc-400 dark:border-zinc-700'>
        なし
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=''
      className='h-9 w-16 shrink-0 rounded border border-zinc-300 object-cover dark:border-zinc-700'
    />
  );
}

export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const all = await listAllPosts();
  const params = parseListParams(await searchParams);
  // Category and search first, so the tabs count what each would show; then the tab and the order.
  // Last edited first by default, so the post being worked on is at the top (lib/admin-post-list.ts).
  const narrowed = narrow(all, params);
  const posts = sortPosts(
    narrowed.filter((post) => matchesStatus(post, params.status)),
    params.sort,
  );

  return (
    <section>
      {/* 新規作成 is the one thing this screen is opened for, so it alone is a button. With no
          posts the empty state carries it instead (EmptyPostList), so the screen never offers two.
          No サイトを見る: SiteHeader's 「Tech Blog」 goes there. */}
      <div className='mb-6 flex items-center justify-between gap-4'>
        <ScreenHeading title='記事一覧' showTags={await isAdmin()} />
        {all.length > 0 && (
          <Link href='/admin/posts/new' className='button-primary px-3 py-1.5 text-sm font-medium'>
            新規作成
          </Link>
        )}
      </div>
      {all.length > 0 && <ListControls params={params} counts={countByStatus(narrowed)} />}
      {/* The list is a white sheet on the grey ground, as the post page's body and the editor's are
          (globals.css `--surface`); the heading stays on the ground above it. */}
      <div className='rounded-xs border border-zinc-200 bg-surface px-4 dark:border-zinc-800'>
        {all.length === 0 ? (
          <EmptyPostList />
        ) : posts.length === 0 ? (
          <p className='py-10 text-center text-sm text-zinc-600 dark:text-zinc-400'>
            条件に合う記事はありません。
            <Link href='/admin' className='ml-2 underline'>
              条件をクリア
            </Link>
          </p>
        ) : (
          <ul className='divide-y divide-zinc-200 dark:divide-zinc-800'>
            {posts.map((post) => (
              <li key={post.id} className='flex items-center justify-between gap-4 py-3'>
                <div className='flex min-w-0 items-center gap-3'>
                  {/* Resolved as every surface does (lib/thumbnail.ts), so this is what a reader
                    sees. The slot is always drawn so the titles stay aligned; 「なし」 means no
                    image at all. Posts in both categories are expected to carry one, so 「なし」
                    is kept visible as the reminder that one is missing, not hidden as noise. */}
                  <AdminThumbnail src={resolveThumbnail(post)} />
                  <div className='min-w-0'>
                    <Link
                      href={`/admin/posts/${post.id}/edit`}
                      className='line-clamp-2 font-medium hover:underline sm:block sm:truncate'>
                      {/* Only a draft can lack a title; a placeholder keeps it clickable. */}
                      {post.title.trim() ? (
                        post.title
                      ) : (
                        <span className='text-zinc-400'>（無題）</span>
                      )}
                    </Link>
                    {/* The state leads the second line rather than trailing the title, so every title
                      starts and ends on its own and the badges line up down the list. It wraps on a
                      phone rather than cut the category off, and truncates from `sm`. */}
                    <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-600 sm:flex-nowrap dark:text-zinc-400'>
                      {post.draft && (
                        <span className='shrink-0 rounded bg-amber-100 px-1.5 leading-4 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'>
                          下書き
                        </span>
                      )}
                      {/* Published rows only: a draft's autosave writes the live columns (lib/posts.ts
                        listAllPosts). Shown here because the author forgets days later, away from the
                        editor. Sky, apart from 下書き's amber. */}
                      {post.hasPendingEdits && (
                        <span className='shrink-0 rounded bg-sky-100 px-1.5 leading-4 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'>
                          未公開の変更
                        </span>
                      )}
                      {/* No slug: a random string (lib/slug.ts) that identifies nothing to a reader of
                        this list. The 表示 link reaches the public URL. */}
                      <span className='min-w-0 sm:truncate'>
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
                            <span className='whitespace-nowrap'>
                              公開 {formatPostDate(post.date)}
                            </span>
                          </>
                        )}
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
                      </span>
                    </div>
                  </div>
                </div>
                <div className='flex shrink-0 items-center gap-3'>
                  {/* Every row has a slug from creation (lib/db/schema.ts), and a draft's address
                    previews for this session (app/(site)/posts/[slug]/page.tsx), so one 表示
                    covers both states; the destination's banner and the 下書き badge say which.
                    Here rather than in the editor, where it would navigate away from it. Below `sm`
                    it moves into ⋯ (PostRowMenu), so the title gets the width. */}
                  {post.slug && (
                    <a
                      href={`/posts/${post.slug}`}
                      className='hidden text-sm text-zinc-600 hover:underline sm:inline dark:text-zinc-400'>
                      表示
                    </a>
                  )}
                  <PostRowMenu id={post.id} slug={post.slug} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
