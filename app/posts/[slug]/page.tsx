import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getPostBySlug } from '@/lib/posts';
import { renderMdxToHtml } from '@/lib/render';

type Params = { slug: string };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
  };
}

export default async function PostPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const html = await renderMdxToHtml(post.body);

  return (
    <article>
      <header className='mb-8'>
        <h1 className='text-4xl font-bold tracking-tight'>{post.title}</h1>
        <div className='mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400'>
          <time dateTime={post.date}>
            {new Date(post.date).toLocaleDateString('ja-JP', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </time>
          <Link
            href={`/categories/${encodeURIComponent(post.category)}`}
            className='hover:underline'>
            {post.category}
          </Link>
        </div>
        {post.tags.length > 0 && (
          <ul className='mt-3 flex flex-wrap gap-2'>
            {post.tags.map((tag) => (
              <li key={tag}>
                <Link
                  href={`/tags/${encodeURIComponent(tag)}`}
                  className='inline-block rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-1 text-xs hover:bg-zinc-200 dark:hover:bg-zinc-700'>
                  #{tag}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </header>
      <div
        className='prose prose-zinc dark:prose-invert max-w-none'
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
