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

// Below this, a table of contents is more clutter than aid (see the design discussion this
// pins: a 1-2 heading post has nothing worth jumping around for).
const MIN_HEADINGS_FOR_TOC = 3;

// A post as a reader sees it: title, dates, category and tags, the body card and its client
// enhancers, and the table of contents. Shared by the public post page and the revision preview
// (docs/revision-requirements.md §5), so what the author judges a version by is drawn exactly as it
// would ship.
//
// `showDates` is off in the revision preview: the dates are the post's, not the version's, and
// under a version's title they would read as its own. `body` replaces the rendered body inside the
// card — the preview's 差分 view — and then there is no table of contents to show.
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
            // max-w-site case — the mobile TOC (TocNavMobile) handles it there.
            //
            // At `toc:` and up: a 3-track grid — calc((100% - column) / 2) | column | 1fr, where
            // `column` is --container-site (app/globals.css), the same variable max-w-site
            // caps at. Track 1 and the content track together always reduce to exactly the same
            // left edge a lone `mx-auto max-w-site` box would have at the same width (both
            // are `(container − column) / 2`), so the rail track only ever eats into space to the
            // *right* of the content column — it can never shift the column itself, and because
            // it's `1fr` (not a fixed size) rather than sharing a flexible remainder with a
            // matching left-side `1fr`, the three tracks always sum to exactly 100% — no
            // horizontal overflow is possible at any width.
            //
            // What this replaces: `mx-auto max-w-[65.5rem]` symmetrically centers the *whole*
            // wider box, which shifts every showToc article ~124px left of SiteHeader and of
            // non-TOC pages. A since-abandoned 4-track version (minmax(1rem,1fr) gutters on both
            // sides + a fixed-width rail track) has the identical bug for the identical reason:
            // two matched flexible gutters always split any added rail width between themselves,
            // moving the left one. Only a gutter defined independently of the rail's size (this
            // calc()) avoids it.
            'mx-auto w-full max-w-site toc:mx-0 toc:max-w-none toc:grid toc:grid-cols-[calc((100%_-_var(--container-site))/2)_var(--container-site)_1fr] toc:items-start'
          : 'mx-auto w-full max-w-site'
      }>
      {/* min-w-0: without it, a grid item's default min-width:auto can force this column wider
        than its fixed track the moment a wide <pre> code block sits inside it. */}
      <div className={showToc ? 'toc:col-start-2 min-w-0' : undefined}>
        <header className='mb-8'>
          <h1 className='text-4xl font-bold tracking-tight'>{post.title}</h1>
          <div className='mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400'>
            {showDates && <time dateTime={post.date}>{formatPostDate(post.date)}</time>}
            {showDates && hasVisibleUpdate(post.date, post.updatedAt) && (
              <time dateTime={post.updatedAt}>更新: {formatPostDate(post.updatedAt)}</time>
            )}
            {/* '' only on a draft or a revision, which only the author previews: a published post
            always has a category (§12.32). No link, since /categories/ has no page for it. */}
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
        {/* Card: separates the body from the page background (Zenn-style) — the header above
          stays on the plain page background, matching Zenn's own layout.
          `sm:px-6` rather than a roomier `sm:px-8`: the card's padding comes out of the content
          column, so it — not the column — sets the body's reading width (--container-site
          − 2×padding − 2×border). At 6 that lands on ~750px; at 8 it would drop to ~734px. */}
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
        {/* Client enhancers: each attaches behaviour to the server-rendered body after mount and
          renders nothing itself — a copy button on each code block, a preview of the note behind
          each footnote reference (which stays a working anchor either way), and the height and
          missing-post fallback for an X embed, which only its own iframe can report
          (docs/embed-requirements.md §10.5, §10.6), and the click that opens a body image
          full-window. */}
        <CodeCopyButtons targetId='post-body' />
        <FootnotePopover targetId='post-body' />
        <EmbedFrames targetId='post-body' />
        <ImageZoom targetId='post-body' />
      </div>
      {showToc && <TocNavDesktop toc={toc} />}
    </article>
  );
}
