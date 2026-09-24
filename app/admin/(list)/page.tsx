import Link from 'next/link';
import { listAllPosts } from '@/lib/posts';
import { deletePostAction } from '@/app/actions/posts';
import { logout } from '@/app/actions/auth';
import { isAdmin } from '@/lib/dal';
import { categoryLabel } from '@/lib/content';
import { formatPostDate, hasVisibleUpdate } from '@/lib/format';
import { resolveThumbnail } from '@/lib/thumbnail';

export const dynamic = 'force-dynamic';

// One row's picture, at the size the row already is (two lines of text) so adding it does not
// change the list's rhythm. `object-cover` because every other surface crops — the public list
// (components/PostCard.tsx), the link card (globals.css `.link-card-image`) and the editor's
// field (components/editor/ThumbnailField.tsx) — and a preview that cropped differently would
// describe a card nobody sees. The bare `<img>` is the same choice, and for the reason spelled
// out at ThumbnailField.tsx: the four surfaces are drawn by one hand.
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
      {/* Both live on this row rather than in a nav band over every admin screen
          (app/admin/layout.tsx says why). The list is the hub both belong to — and it keeps
          the empty-state sentence below, which names 「新規記事」, pointing at something on the
          same screen. No サイトを見る: SiteHeader's own 「Tech Blog」 is above this row and goes
          to the same place (app/admin/(list)/layout.tsx). */}
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
            <button type='submit' className='text-zinc-500 hover:underline dark:text-zinc-400'>
              ログアウト
            </button>
          </form>
        </div>
      </div>
      {posts.length === 0 ? (
        <p className='text-zinc-500 dark:text-zinc-400'>
          記事がありません。「新規記事」から作成できます。
        </p>
      ) : (
        <ul className='divide-y divide-zinc-200 dark:divide-zinc-800'>
          {posts.map((post) => (
            <li key={post.id} className='flex items-center justify-between gap-4 py-3'>
              <div className='flex min-w-0 items-center gap-3'>
                {/* The card image, resolved the same way every other surface resolves it
                    (lib/thumbnail.ts) — so what shows here is what a reader would see, not the
                    stored column. The slot is always drawn, unlike the public list's: the rows
                    here are one text block tall and a picture that came and went would make the
                    titles ragged. 「なし」 therefore means the post has no image AT ALL, an
                    explicit choice and a body image being equally an image. */}
                <AdminThumbnail src={resolveThumbnail(post)} />
                <div className='min-w-0'>
                  <div className='flex items-center gap-2'>
                    <Link
                      href={`/admin/posts/${post.id}/edit`}
                      className='truncate font-medium hover:underline'>
                      {/* A titleless draft would render an empty, unclickable link
                          (publish requires a title, so only drafts reach here);
                          show a placeholder so it stays reachable from the list. */}
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
                    {/* Only ever on a published row — a draft's autosave writes the live columns,
                        so draft_content stays null (lib/posts.ts listAllPosts). It is here rather
                        than only in the editor because forgetting happens days later: inside the
                        editor the same state is the publish button being pressable, which you
                        have to be in the editor to see. Sky, so it reads apart from 下書き's amber. */}
                    {post.hasPendingEdits && (
                      <span className='rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'>
                        未公開の変更
                      </span>
                    )}
                  </div>
                  {/* No slug. It is a 20-hex random string (lib/slug.ts) that names nothing a
                      reader of this list is looking for, and it was the widest thing on the
                      line — the title it sits under is what identifies the row. Reaching the
                      public URL is the 表示 link's job now. */}
                  <div className='truncate text-xs text-zinc-500 dark:text-zinc-400'>
                    {formatPostDate(post.date) || '未公開'}
                    {hasVisibleUpdate(post.date, post.updatedAt) && (
                      <> (更新: {formatPostDate(post.updatedAt)})</>
                    )}{' '}
                    · {categoryLabel(post.category)}
                  </div>
                </div>
              </div>
              <div className='flex shrink-0 items-center gap-4'>
                {/* Moved off the editor's pinned publish row, where it was a same-tab navigation
                    out of a mounted editor. Every row has a slug from the moment autosave created
                    it (lib/db/schema.ts), drafts included, and the address now answers the author
                    for a draft too — app/(site)/posts/[slug]/page.tsx serves one to a request
                    carrying this session. So one word covers both: the action is the same, and it
                    can no longer land on a 404.

                    Not 表示 / プレビュー. That split was worth having only while a draft's link
                    was a trap; with the preview in place the two labels would differ just to say
                    ahead of time what the destination says on arrival (its 下書きのプレビュー
                    banner), and the row already carries the state — the 下書き badge above. (Not
                    the date column: `date` is stamped at first publish and never cleared, so a
                    post taken back to a draft still shows one.) */}
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
