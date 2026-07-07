import Link from 'next/link';
import { listAllPosts } from '@/lib/posts';
import { deletePostAction } from '@/app/actions/posts';
import { formatPostDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const posts = await listAllPosts();

  return (
    <section>
      <h1 className='mb-6 text-2xl font-bold tracking-tight'>記事一覧</h1>
      {posts.length === 0 ? (
        <p className='text-zinc-500 dark:text-zinc-400'>
          記事がありません。「新規記事」から作成できます。
        </p>
      ) : (
        <ul className='divide-y divide-zinc-200 dark:divide-zinc-800'>
          {posts.map((post) => (
            <li key={post.id} className='flex items-center justify-between gap-4 py-3'>
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
                </div>
                <div className='truncate text-xs text-zinc-500 dark:text-zinc-400'>
                  {post.slug} · {formatPostDateTime(post.date) || '未公開'} · {post.category}
                </div>
              </div>
              <form action={deletePostAction}>
                <input type='hidden' name='id' value={post.id} />
                <button type='submit' className='text-sm text-red-600 hover:underline'>
                  削除
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
