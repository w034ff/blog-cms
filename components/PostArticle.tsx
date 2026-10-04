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
// with the preview's 差分 view, and then there is no table of contents. `column: 'editor'` is the
// preview's: the editor's column, with the card padded like the editor's frame so the body is
// still `--container-site` wide, and no table of contents, which the editor has none of either
// (docs/editor-requirements.md §12.35).
export function PostArticle({
  post,
  html,
  toc,
  showDates = true,
  body,
  column = 'page',
}: {
  post: Post;
  html: string;
  toc: TocEntry[];
  showDates?: boolean;
  body?: ReactNode;
  column?: 'page' | 'editor';
}) {
  const inEditor = column === 'editor';
  const showToc = !inEditor && body === undefined && toc.length >= MIN_HEADINGS_FOR_TOC;
  return (
    // The page box, as on every other page, with the body at its left edge, so it never moves when
    // the ToC appears or a post has none (docs/toc-requirements.md §6). From `toc:` the rail's track
    // is fixed and the body takes the rest up to its own width: 800px when the box is full, down to
    // about 640px at the breakpoint.
    <article
      className={`mx-auto w-full ${inEditor ? 'max-w-editor' : 'max-w-page'} ${showToc ? 'toc:grid toc:grid-cols-[minmax(0,var(--container-site))_var(--toc-rail)] toc:items-start' : ''}`}>
      {/* min-w-0, or a wide <pre> forces the column past its track (min-width:auto). */}
      <div className={`min-w-0 ${inEditor ? '' : 'max-w-site'}`}>
        <header className='mb-8'>
          <h1 className='text-4xl font-bold tracking-tight'>{post.title}</h1>
          <div className='mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400'>
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
                data-category={post.category}
                className='category-mark hover:underline'>
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
                    className='tag-chip px-3 py-1 text-xs'>
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
        <div
          className={`rounded-panel border border-zinc-200 bg-surface py-6 dark:border-zinc-800 sm:py-8 ${inEditor ? 'px-(--editor-gutter)' : 'px-4 sm:px-6'}`}>
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
