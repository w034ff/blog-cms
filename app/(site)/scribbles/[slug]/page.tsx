import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CodeCopyButtons } from '@/components/CodeCopyButtons';
import { DraftPreviewBanner } from '@/components/DraftPreviewBanner';
import { EmbedFrames } from '@/components/EmbedFrames';
import { FootnotePopover } from '@/components/FootnotePopover';
import { ImageZoom } from '@/components/ImageZoom';
import { LibraryButtons } from '@/components/LibraryButtons';
import { getOptionalSession } from '@/lib/dal';
import { markState } from '@/lib/library';
import { formatScribbleDayIso } from '@/lib/format';
import { getScribbleBySlug, getScribbleDraftBySlug } from '@/lib/posts';
import { renderMdxToHtml } from '@/lib/render';
import { resolveCard } from '@/lib/resolve-card';
import { scribbleDetailMetadata } from '@/lib/scribble-list';
import { getSiteIdentity } from '@/lib/site-settings';
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
  return scribbleDetailMetadata(await getSiteIdentity(), readable.post, readable.preview);
}

export default async function ScribblePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const readable = await readableScribble(slug);
  if (!readable) notFound();
  const { post, preview } = readable;

  const session = !preview ? await getOptionalSession() : null;
  const mark = session ? markState(session.userId, post.id) : null;

  const { html } = await renderMdxToHtml(post.body, { resolveCard });

  return (
    <>
      {preview && <DraftPreviewBanner postId={post.id} />}
      <article className='mx-auto w-full max-w-page'>
        <div className='mb-4'>
          <Link
            href='/scribbles'
            className='inline-flex items-center text-sm text-(--chip-fg) hover:underline'>
            ← 走り書きの一覧
          </Link>
        </div>
        <div className='rounded-panel border border-zinc-200 bg-surface px-5 py-6 sm:px-7 dark:border-zinc-800'>
          <header className='mb-4'>
            <time dateTime={post.date} className='font-mono text-[13px] text-(--chip-fg)'>
              {formatScribbleDayIso(post.date)}
            </time>
            <h1 className='mt-2 text-2xl leading-snug font-bold'>{post.title}</h1>
          </header>
          <div
            id='scribble-body'
            className='prose prose-zinc dark:prose-invert max-w-none leading-[1.85]'
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {post.tagList.length > 0 && (
            <ul className='mt-4.5 flex flex-wrap gap-2'>
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
        {mark && (
          <LibraryButtons
            postId={post.id}
            initialBookmarked={mark.bookmarked}
            initialLiked={mark.liked}
            canLike={mark.canLike}
          />
        )}
        <CodeCopyButtons targetId='scribble-body' />
        <FootnotePopover targetId='scribble-body' />
        <EmbedFrames targetId='scribble-body' />
        <ImageZoom targetId='scribble-body' />
      </article>
    </>
  );
}
