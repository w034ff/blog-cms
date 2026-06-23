import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPostsByCategory } from '@/lib/posts';
import { PostCard } from '@/components/PostCard';

type Params = { category: string };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { category } = await params;
  return { title: decodeURIComponent(category) };
}

export default async function CategoryPage({ params }: { params: Promise<Params> }) {
  const { category } = await params;
  const decoded = decodeURIComponent(category);
  const posts = await getPostsByCategory(decoded);
  if (posts.length === 0) notFound();
  return (
    <section>
      <h1 className='text-3xl font-bold tracking-tight mb-6'>
        {decoded} <span className='text-zinc-500 dark:text-zinc-400 text-xl'>({posts.length})</span>
      </h1>
      <div className='divide-y divide-zinc-200 dark:divide-zinc-800'>
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>
    </section>
  );
}
