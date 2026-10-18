import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { categoryLabel, isCategoryId } from '@/lib/content';
import { getPostsByCategory } from '@/lib/posts';
import { PostCardGrid } from '@/components/PostCard';
import { CategoryTabs, PostListPager } from '@/components/PostListNav';
import { pagedTitle, postListPage } from '@/lib/post-list';
import { parsePageNumber } from '@/lib/scribble-list';
import { sharedOpenGraph } from '@/app/shared-metadata';
import { getSiteIdentity } from '@/lib/site-settings';

type Params = { category: string };
type SearchParams = { page?: string | string[] };

export const dynamic = 'force-dynamic';

// Addressed by id (`/categories/tech`), titled by label. An id off the list, including the
// free-text era's (`/categories/tech-notes`), is a 404 before the query runs.
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { category } = await params;
  const id = decodeURIComponent(category);
  if (!isCategoryId(id)) notFound();
  const title = pagedTitle(categoryLabel(id), parsePageNumber((await searchParams).page));
  // As in app/(site)/tags/[tag]/page.tsx: an unset openGraph would carry the site's own title.
  return {
    title,
    openGraph: {
      ...sharedOpenGraph(await getSiteIdentity()),
      title,
      url: `/categories/${category}`,
    },
  };
}

// The home page's tabs and cards, filtered to one category (docs/home-requirements.md §2). A
// category with no posts yet is an empty list, not a 404: its tab is on every list page.
export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { category } = await params;
  const id = decodeURIComponent(category);
  if (!isCategoryId(id)) notFound();
  const page = parsePageNumber((await searchParams).page);
  const { posts, totalPages } = postListPage(await getPostsByCategory(id), page);
  if (page > totalPages) notFound();
  return (
    <section className='mx-auto w-full max-w-page'>
      {/* The tab names the list (CategoryTabs); the heading stays for assistive tech. */}
      <h1 className='sr-only'>{categoryLabel(id)}</h1>
      <CategoryTabs active={id} />
      {posts.length === 0 ? (
        <p className='text-zinc-600 dark:text-zinc-400'>まだ記事がありません。</p>
      ) : (
        <>
          <PostCardGrid posts={posts} />
          <PostListPager basePath={`/categories/${id}`} page={page} totalPages={totalPages} />
        </>
      )}
    </section>
  );
}
