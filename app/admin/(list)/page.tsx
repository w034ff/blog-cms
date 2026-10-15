import Link from 'next/link';
import { listAllPosts } from '@/lib/posts';
import { isAdmin } from '@/lib/dal';
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
import { PostListRows } from './PostListRows';

export const dynamic = 'force-dynamic';

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
      <div className='rounded-panel border border-zinc-200 bg-surface px-4 dark:border-zinc-800'>
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
          <PostListRows posts={posts} />
        )}
      </div>
    </section>
  );
}
