import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllPosts } from '@/lib/posts';
import { readPinnedPostId } from '@/lib/pinned-post';
import { pagedTitle, postListPage, splitPinned } from '@/lib/post-list';
import { parsePageNumber } from '@/lib/scribble-list';
import { PinnedPost } from '@/components/PinnedPost';
import { PostCardGrid } from '@/components/PostCard';
import { CategoryTabs, PostListPager } from '@/components/PostListNav';

type SearchParams = { page?: string | string[] };

export const dynamic = 'force-dynamic';

const HOME_HEADING = '最新の記事';

// Page 1 keeps the site's own title (the root layout's); a later page says which it is.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const page = parsePageNumber((await searchParams).page);
  return page > 1 ? { title: pagedTitle(HOME_HEADING, page) } : {};
}

// docs/home-requirements.md: the tabs, the pinned post on page 1, then the cards, 20 to a page. The
// pinned post is taken out of the list before it is paged, so it is never drawn twice (§3).
export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = parsePageNumber((await searchParams).page);
  const { pinned, rest } = splitPinned(await getAllPosts(), readPinnedPostId());
  const { posts, totalPages } = postListPage(rest, page);
  if (page > totalPages) notFound();
  return (
    <section className='mx-auto w-full max-w-page'>
      {/* The tab names the list (CategoryTabs); the heading stays for assistive tech. */}
      <h1 className='sr-only'>{HOME_HEADING}</h1>
      <CategoryTabs active={null} />
      {pinned === null && posts.length === 0 ? (
        <p className='text-zinc-600 dark:text-zinc-400'>まだ記事がありません。</p>
      ) : (
        <>
          {pinned !== null && page === 1 && <PinnedPost post={pinned} />}
          <PostCardGrid posts={posts} />
          <PostListPager basePath='/' page={page} totalPages={totalPages} />
        </>
      )}
    </section>
  );
}
