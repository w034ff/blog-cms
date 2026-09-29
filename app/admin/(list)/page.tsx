import Link from 'next/link';
import { listAllPosts } from '@/lib/posts';
import { deletePostAction } from '@/app/actions/posts';
import { logout } from '@/app/actions/auth';
import { isAdmin } from '@/lib/dal';
import { categoryLabel } from '@/lib/content';
import { formatPostDate, hasVisibleUpdate } from '@/lib/format';
import { resolveThumbnail } from '@/lib/thumbnail';

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

export default async function AdminHome() {
  const posts = await listAllPosts();
  const admin = await isAdmin();

  return (
    <section>
      {/* On this row rather than a nav band over every admin screen (app/admin/layout.tsx), so the
          empty-state sentence's 「新規記事」 points at something on screen. No サイトを見る:
          SiteHeader's 「Tech Blog」 goes there (app/admin/(list)/layout.tsx). */}
      <div className='mb-6 flex items-center justify-between gap-4'>
        <h1 className='text-2xl font-bold tracking-tight'>記事一覧</h1>
        <div className='flex items-center gap-4 text-sm'>
          <Link href='/admin/posts/new' className='font-medium hover:underline'>
            新規記事
          </Link>
          {admin && (
            <Link href='/admin/tags' className='hover:underline'>
              タグ
            </Link>
          )}
          <form action={logout}>
            <button type='submit' className='text-zinc-600 hover:underline dark:text-zinc-400'>
              ログアウト
            </button>
          </form>
        </div>
      </div>
      {posts.length === 0 ? (
        <p className='text-zinc-600 dark:text-zinc-400'>
          記事がありません。「新規記事」から作成できます。
        </p>
      ) : (
        <ul className='divide-y divide-zinc-200 dark:divide-zinc-800'>
          {posts.map((post) => (
            <li key={post.id} className='flex items-center justify-between gap-4 py-3'>
              <div className='flex min-w-0 items-center gap-3'>
                {/* Resolved as every surface does (lib/thumbnail.ts), so this is what a reader
                    sees. The slot is always drawn so the titles stay aligned; 「なし」 means no
                    image at all. */}
                <AdminThumbnail src={resolveThumbnail(post)} />
                <div className='min-w-0'>
                  <div className='flex items-center gap-2'>
                    <Link
                      href={`/admin/posts/${post.id}/edit`}
                      className='truncate font-medium hover:underline'>
                      {/* Only a draft can lack a title; a placeholder keeps it clickable. */}
                      {post.title.trim() ? (
                        post.title
                      ) : (
                        <span className='text-zinc-400'>（無題）</span>
                      )}
                    </Link>
                    {post.draft && (
                      <span className='rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'>
                        下書き
                      </span>
                    )}
                    {/* Published rows only: a draft's autosave writes the live columns (lib/posts.ts
                        listAllPosts). Shown here because the author forgets days later, away from the
                        editor. Sky, apart from 下書き's amber. */}
                    {post.hasPendingEdits && (
                      <span className='rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'>
                        未公開の変更
                      </span>
                    )}
                  </div>
                  {/* No slug: a random string (lib/slug.ts) that identifies nothing to a reader of this
                      list. The 表示 link reaches the public URL. */}
                  <div className='truncate text-xs text-zinc-600 dark:text-zinc-400'>
                    {formatPostDate(post.date) || '未公開'}
                    {hasVisibleUpdate(post.date, post.updatedAt) && (
                      <> (更新: {formatPostDate(post.updatedAt)})</>
                    )}{' '}
                    · {categoryLabel(post.category)}
                  </div>
                </div>
              </div>
              <div className='flex shrink-0 items-center gap-4'>
                {/* Every row has a slug from creation (lib/db/schema.ts), and a draft's address
                    previews for this session (app/(site)/posts/[slug]/page.tsx), so one 表示
                    covers both states; the destination's banner and the 下書き badge say which.
                    Here rather than in the editor, where it would navigate away from it. */}
                {post.slug && (
                  <a
                    href={`/posts/${post.slug}`}
                    className='text-sm text-zinc-600 hover:underline dark:text-zinc-400'>
                    表示
                  </a>
                )}
                <form action={deletePostAction}>
                  <input type='hidden' name='id' value={post.id} />
                  <button type='submit' className='text-sm text-red-600 hover:underline'>
                    削除
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
