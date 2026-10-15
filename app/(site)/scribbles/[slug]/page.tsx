import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CodeCopyButtons } from '@/components/CodeCopyButtons';
import { DraftPreviewBanner } from '@/components/DraftPreviewBanner';
import { EmbedFrames } from '@/components/EmbedFrames';
import { FootnotePopover } from '@/components/FootnotePopover';
import { ImageZoom } from '@/components/ImageZoom';
import { getOptionalSession } from '@/lib/dal';
import { formatPostDate } from '@/lib/format';
import { getScribbleBySlug, getScribbleDraftBySlug } from '@/lib/posts';
import { renderMdxToHtml } from '@/lib/render';
import { resolveCard } from '@/lib/resolve-card';
import { scribbleDetailMetadata } from '@/lib/scribble-list';
import type { Post } from '@/lib/types';

type Params = { slug: string };

export const dynamic = 'force-dynamic';

async function readableScribble(slug: string): Promise<{ post: Post; preview: boolean } | null> {
  const published = await getScribbleBySlug(slug);
  if (published) return { post: published, preview: false };
  if (!(await getOptionalSession())) return null;
  const draft = await getScribbleDraftBySlug(slug);
  return draft ? { post: draft, preview: true } : null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const readable = await readableScribble(slug);
  if (!readable) return {};
  return scribbleDetailMetadata(readable.post, readable.preview);
}

export default async function ScribblePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const readable = await readableScribble(slug);
  if (!readable) notFound();
  const { post, preview } = readable;

  const { html } = await renderMdxToHtml(post.body, { resolveCard });

  return (
    <>
      {preview && <DraftPreviewBanner postId={post.id} />}
      <article className='mx-auto w-full max-w-page'>
        <div className='mb-6'>
          <Link
            href='/scribbles'
            className='inline-flex items-center text-sm text-zinc-600 hover:underline dark:text-zinc-400'>
            ← 走り書きの一覧
          </Link>
        </div>
        <div className='rounded-panel border border-zinc-200 bg-surface px-4 py-6 sm:px-6 sm:py-8 dark:border-zinc-800'>
          <header className='mb-6'>
            <time dateTime={post.date} className='text-sm text-zinc-600 dark:text-zinc-400'>
              {formatPostDate(post.date)}
            </time>
            <h1 className='mt-2 text-3xl font-bold tracking-tight sm:text-4xl'>{post.title}</h1>
          </header>
          <div
            id='scribble-body'
            className='prose prose-zinc dark:prose-invert max-w-none'
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {post.tagList.length > 0 && (
            <ul className='mt-6 flex flex-wrap gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800'>
              {post.tagList.map(({ slug: tagSlug, name }) => (
                <li key={tagSlug}>
                  <Link
                    href={`/tags/${encodeURIComponent(tagSlug)}`}
                    className='tag-chip px-3 py-1 text-xs'>
                    #{name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <CodeCopyButtons targetId='scribble-body' />
        <FootnotePopover targetId='scribble-body' />
        <EmbedFrames targetId='scribble-body' />
        <ImageZoom targetId='scribble-body' />
      </article>
    </>
  );
}
