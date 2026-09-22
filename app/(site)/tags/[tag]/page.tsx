import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPostsByTag } from '@/lib/posts';
import { PostCard } from '@/components/PostCard';
import { sharedOpenGraph } from '@/app/shared-metadata';

type Params = { tag: string };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { tag } = await params;
  const title = `#${decodeURIComponent(tag)}`;
  // og:title does NOT follow `title` — a page that leaves `openGraph` unset
  // inherits the layout's whole object, so a shared tag page would announce
  // itself as the site's front page.
  return { title, openGraph: { ...sharedOpenGraph, title, url: `/tags/${tag}` } };
}

export default async function TagPage({ params }: { params: Promise<Params> }) {
  const { tag } = await params;
  const decoded = decodeURIComponent(tag);
  const posts = await getPostsByTag(decoded);
  if (posts.length === 0) notFound();
  return (
    <section className='mx-auto w-full max-w-site'>
      <h1 className='text-3xl font-bold tracking-tight mb-6'>
        #{decoded}{' '}
        <span className='text-zinc-500 dark:text-zinc-400 text-xl'>({posts.length})</span>
      </h1>
      <div className='divide-y divide-zinc-200 dark:divide-zinc-800'>
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>
    </section>
  );
}
