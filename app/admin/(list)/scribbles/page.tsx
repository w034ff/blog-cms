import type { Metadata } from 'next';
import Link from 'next/link';
import { listAllScribbles } from '@/lib/posts';
import { isAdmin } from '@/lib/dal';
import {
  countByStatus,
  matchesStatus,
  narrow,
  parseListParams,
  sortPosts,
} from '@/lib/admin-post-list';
import { ListControls } from '../ListControls';
import { ScreenHeading } from '../ScreenHeading';
import { PostListRows } from '../PostListRows';

export const metadata: Metadata = { title: '走り書き' };
export const dynamic = 'force-dynamic';

function EmptyScribbleList() {
  return (
    <div className='flex flex-col items-center px-4 py-14 text-center'>
      <p className='text-sm text-zinc-600 dark:text-zinc-400'>まだ走り書きがありません。</p>
      <Link
        href='/admin/posts/new?kind=scribble'
        className='button-primary mt-6 px-5 py-2.5 font-medium'>
        新規作成
      </Link>
    </div>
  );
}

export default async function AdminScribblesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const all = await listAllScribbles();
  const params = parseListParams(await searchParams);
  const narrowed = narrow(all, params);
  const posts = sortPosts(
    narrowed.filter((post) => matchesStatus(post, params.status)),
    params.sort,
  );

  return (
    <section>
      <div className='mb-6 flex items-center justify-between gap-4'>
        <ScreenHeading title='走り書き' showTags={await isAdmin()} />
        {all.length > 0 && (
          <Link
            href='/admin/posts/new?kind=scribble'
            className='button-primary px-3 py-1.5 text-sm font-medium'>
            新規作成
          </Link>
        )}
      </div>
      {all.length > 0 && (
        <ListControls
          params={params}
          counts={countByStatus(narrowed)}
          basePath='/admin/scribbles'
          showCategory={false}
        />
      )}
      <div className='rounded-panel border border-zinc-200 bg-surface px-4 dark:border-zinc-800'>
        {all.length === 0 ? (
          <EmptyScribbleList />
        ) : posts.length === 0 ? (
          <p className='py-10 text-center text-sm text-zinc-600 dark:text-zinc-400'>
            条件に合う走り書きはありません。
            <Link href='/admin/scribbles' className='ml-2 underline'>
              条件をクリア
            </Link>
          </p>
        ) : (
          <PostListRows posts={posts} kind='scribble' />
        )}
      </div>
    </section>
  );
}
