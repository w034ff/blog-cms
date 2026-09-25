import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Post } from '@/lib/types';
import type { TocEntry } from '@/lib/render';
import { categoryLabel } from '@/lib/content';
import { formatPostDate, hasVisibleUpdate } from '@/lib/format';
import { CodeCopyButtons } from '@/components/CodeCopyButtons';
import { EmbedFrames } from '@/components/EmbedFrames';
import { FootnotePopover } from '@/components/FootnotePopover';
import { ImageZoom } from '@/components/ImageZoom';
import { TocNavMobile, TocNavDesktop } from '@/components/TocNav';

// Fewer headings than this get no table of contents (docs/toc-requirements.md §5).
const MIN_HEADINGS_FOR_TOC = 3;

// A post as a reader sees it, shared by the post page and the revision preview
// (docs/revision-requirements.md §5), so a version is judged as it would ship. `showDates` is off
// in the preview (the dates are the post's, not the version's). `body` replaces the rendered body
// with the preview's 差分 view, and then there is no table of contents.
export function PostArticle({
  post,
  html,
  toc,
  showDates = true,
  body,
}: {
  post: Post;
  html: string;
  toc: TocEntry[];
  showDates?: boolean;
  body?: ReactNode;
}) {
  const showToc = body === undefined && toc.length >= MIN_HEADINGS_FOR_TOC;
  return (
    <article
      className={
        showToc
          ? // Below `toc:` (app/globals.css --breakpoint-toc): identical to the plain
            // max-w-site case; the mobile TOC handles it there.
            //
            // At `toc:` and up, three tracks: calc((100% - column) / 2) | column | 1fr, where
            // `column` is --container-site (app/globals.css), the same variable max-w-site caps at.
            // The first track keeps the column exactly where a lone `mx-auto max-w-site` box puts
            // it, and the tracks sum to 100%, so nothing overflows (docs/toc-requirements.md §6,
            // which also records the rejected layouts).
            'mx-auto w-full max-w-site toc:mx-0 toc:max-w-none toc:grid toc:grid-cols-[calc((100%_-_var(--container-site))/2)_var(--container-site)_1fr] toc:items-start'
          : 'mx-auto w-full max-w-site'
      }>
      {/* min-w-0, or a wide <pre> forces the column past its track (min-width:auto). */}
      <div className={showToc ? 'toc:col-start-2 min-w-0' : undefined}>
        <header className='mb-8'>
          <h1 className='text-4xl font-bold tracking-tight'>{post.title}</h1>
          <div className='mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400'>
            {showDates && <time dateTime={post.date}>{formatPostDate(post.date)}</time>}
            {showDates && hasVisibleUpdate(post.date, post.updatedAt) && (
              <time dateTime={post.updatedAt}>更新: {formatPostDate(post.updatedAt)}</time>
            )}
            {/* '' only on a draft or revision, which only the author previews; published posts
                always have one (§12.32). No link: no /categories/ page for it. */}
            {post.category === '' ? (
              <span>{categoryLabel(post.category)}</span>
            ) : (
              <Link
                href={`/categories/${encodeURIComponent(post.category)}`}
                className='hover:underline'>
                {categoryLabel(post.category)}
              </Link>
            )}
          </div>
          {post.tagList.length > 0 && (
            <ul className='mt-3 flex flex-wrap gap-2'>
              {post.tagList.map(({ slug, name }) => (
                <li key={slug}>
                  <Link
                    href={`/tags/${encodeURIComponent(slug)}`}
                    className='inline-block rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-1 text-xs hover:bg-zinc-200 dark:hover:bg-zinc-700'>
                    #{name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </header>
        {/* The card separates the body from the page, as Zenn does. `sm:px-6`: the padding
            comes out of the column, so it sets the reading width (~750px; px-8 would be
            ~734px). */}
        <div className='rounded-lg border border-zinc-200 bg-white px-4 py-6 dark:border-zinc-800 dark:bg-zinc-900 sm:px-6 sm:py-8'>
          {body ?? (
            <>
              {showToc && <TocNavMobile toc={toc} />}
              <div
                id='post-body'
                className='prose prose-zinc dark:prose-invert max-w-none'
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </>
          )}
        </div>
        {/* Client enhancers, attaching behaviour to the server-rendered body and rendering
            nothing: code copy buttons, footnote previews (the references stay anchors), X embed
            height and missing-post fallback (docs/embed-requirements.md §10.5, §10.6), and
            image zoom. */}
        <CodeCopyButtons targetId='post-body' />
        <FootnotePopover targetId='post-body' />
        <EmbedFrames targetId='post-body' />
        <ImageZoom targetId='post-body' />
      </div>
      {showToc && <TocNavDesktop toc={toc} />}
    </article>
  );
}
