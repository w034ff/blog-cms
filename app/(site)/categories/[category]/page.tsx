import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { categoryLabel, isCategoryId } from '@/lib/content';
import { getPostsByCategory } from '@/lib/posts';
import { PostCard } from '@/components/PostCard';
import { sharedOpenGraph } from '@/app/shared-metadata';

type Params = { category: string };

export const dynamic = 'force-dynamic';

// Addressed by id (`/categories/tech`), titled by label. An id off the list, including the
// free-text era's (`/categories/tech-notes`), is a 404 before the query runs.
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { category } = await params;
  const id = decodeURIComponent(category);
  if (!isCategoryId(id)) return {};
  const title = categoryLabel(id);
  // As in app/(site)/tags/[tag]/page.tsx: an unset openGraph would carry the site's own title.
  return { title, openGraph: { ...sharedOpenGraph, title, url: `/categories/${category}` } };
}

export default async function CategoryPage({ params }: { params: Promise<Params> }) {
  const { category } = await params;
  const id = decodeURIComponent(category);
  if (!isCategoryId(id)) notFound();
  const posts = await getPostsByCategory(id);
  if (posts.length === 0) notFound();
  return (
    <section className='mx-auto w-full max-w-site'>
      <h1 className='text-3xl font-bold tracking-tight mb-6'>
        {categoryLabel(id)}{' '}
        <span className='text-zinc-600 dark:text-zinc-400 text-xl'>({posts.length})</span>
      </h1>
      <div className='divide-y divide-zinc-200 dark:divide-zinc-800'>
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>
    </section>
  );
}
