import type { Metadata } from 'next';
import Link from 'next/link';
import { listAllScribbles } from '@/lib/posts';
import { isAdmin, verifySession } from '@/lib/dal';
import { likeCounts } from '@/lib/library';
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
import { EmptyScribbleList } from '../EmptyPostList';

export const metadata: Metadata = { title: '走り書き' };
export const dynamic = 'force-dynamic';

export default async function AdminScribblesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await isAdmin();
  const session = await verifySession();
  const all = await listAllScribbles(admin ? undefined : session.userId);
  const likes = likeCounts();
  // Scribbles omit category filtering (docs/scribble-requirements.md §6):
  // even if ?category= is present in the URL, ignore it so scribbles are not filtered out.
  const params = { ...parseListParams(await searchParams), category: null };
  const narrowed = narrow(all, params);
  const posts = sortPosts(
    narrowed.filter((post) => matchesStatus(post, params.status)),
    params.sort,
  );

  return (
    <section>
      <div className='mb-6'>
        <ScreenHeading title='走り書き' admin={admin} />
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
          <PostListRows posts={posts} kind='scribble' likesCount={likes} showAuthor={admin} />
        )}
      </div>
    </section>
  );
}
