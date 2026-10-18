import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getPostsByTag } from '@/lib/posts';
import { aliasTargets, tagNames } from '@/lib/tags';
import { PostCardGrid } from '@/components/PostCard';
import { PostListPager } from '@/components/PostListNav';
import { pagedTitle, postListPage } from '@/lib/post-list';
import { parsePageNumber } from '@/lib/scribble-list';
import { sharedOpenGraph } from '@/app/shared-metadata';
import { getSiteIdentity } from '@/lib/site-settings';

type Params = { tag: string };
type SearchParams = { page?: string | string[] };

export const dynamic = 'force-dynamic';

// Addressed by slug, titled by the dictionary's name. A slug the dictionary does not have is a 404
// before any post is read.
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { tag } = await params;
  const name = tagNames().get(decodeURIComponent(tag));
  if (name === undefined) notFound();
  const title = pagedTitle(`#${name}`, parsePageNumber((await searchParams).page));
  // `openGraph` left unset inherits the layout's whole object, so a shared tag page would announce
  // itself as the front page.
  return {
    title,
    openGraph: { ...sharedOpenGraph(await getSiteIdentity()), title, url: `/tags/${tag}` },
  };
}

export default async function TagPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { tag } = await params;
  const page = parsePageNumber((await searchParams).page);
  const slug = decodeURIComponent(tag);
  const name = tagNames().get(slug);
  if (name === undefined) {
    // An alias leads to its tag's own page, so each tag has one URL. 307 rather than 308: an alias
    // can be taken off in /admin/tags, and a browser keeps a permanent redirect after it is gone.
    const target = aliasTargets().get(slug);
    if (target !== undefined) redirect(`/tags/${encodeURIComponent(target)}`);
    notFound();
  }
  const all = await getPostsByTag(slug);
  if (all.length === 0) notFound();
  const { posts, totalPages } = postListPage(all, page);
  if (page > totalPages) notFound();
  // No tabs: a tag cuts across the categories, so no tab would be the current one
  // (docs/home-requirements.md §2). The heading stays visible, with the count of every page.
  return (
    <section className='mx-auto w-full max-w-page'>
      <h1 className='text-3xl font-bold tracking-tight mb-6'>
        #{name} <span className='text-zinc-600 dark:text-zinc-400 text-xl'>({all.length})</span>
      </h1>
      <PostCardGrid posts={posts} />
      <PostListPager
        basePath={`/tags/${encodeURIComponent(slug)}`}
        page={page}
        totalPages={totalPages}
      />
    </section>
  );
}
