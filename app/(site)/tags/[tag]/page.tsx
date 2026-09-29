import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getPostsByTag } from '@/lib/posts';
import { aliasTargets, tagNames } from '@/lib/tags';
import { PostCard } from '@/components/PostCard';
import { sharedOpenGraph } from '@/app/shared-metadata';

type Params = { tag: string };

export const dynamic = 'force-dynamic';

// Addressed by slug, titled by the dictionary's name. A slug the dictionary does not have is a 404
// before any post is read.
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { tag } = await params;
  const name = tagNames().get(decodeURIComponent(tag));
  if (name === undefined) return {};
  const title = `#${name}`;
  // `openGraph` left unset inherits the layout's whole object, so a shared tag page would announce
  // itself as the front page.
  return { title, openGraph: { ...sharedOpenGraph, title, url: `/tags/${tag}` } };
}

export default async function TagPage({ params }: { params: Promise<Params> }) {
  const { tag } = await params;
  const slug = decodeURIComponent(tag);
  const name = tagNames().get(slug);
  if (name === undefined) {
    // An alias leads to its tag's own page, so each tag has one URL. 307 rather than 308: an alias
    // can be taken off in /admin/tags, and a browser keeps a permanent redirect after it is gone.
    const target = aliasTargets().get(slug);
    if (target !== undefined) redirect(`/tags/${encodeURIComponent(target)}`);
    notFound();
  }
  const posts = await getPostsByTag(slug);
  if (posts.length === 0) notFound();
  return (
    <section className='mx-auto w-full max-w-site'>
      <h1 className='text-3xl font-bold tracking-tight mb-6'>
        #{name} <span className='text-zinc-600 dark:text-zinc-400 text-xl'>({posts.length})</span>
      </h1>
      <div className='divide-y divide-zinc-200 dark:divide-zinc-800'>
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </div>
    </section>
  );
}
