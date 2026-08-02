import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getPostBySlug } from '@/lib/posts';
import { renderMdxToHtml } from '@/lib/render';
import { formatPostDate } from '@/lib/format';
import { CodeCopyButtons } from '@/components/CodeCopyButtons';
import { TocNavMobile, TocNavDesktop } from '@/components/TocNav';

type Params = { slug: string };

// Below this, a table of contents is more clutter than aid (see the design discussion this
// pins: a 1-2 heading post has nothing worth jumping around for).
const MIN_HEADINGS_FOR_TOC = 3;

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

  const { html, toc } = await renderMdxToHtml(post.body);
  const showToc = toc.length >= MIN_HEADINGS_FOR_TOC;

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
            <time dateTime={post.date}>{formatPostDate(post.date)}</time>
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
        {/* Card: separates the body from the page background (Zenn-style) — the header above
            stays on the plain page background, matching Zenn's own layout.
            `sm:px-6` rather than a roomier `sm:px-8`: the card's padding comes out of the content
            column, so it — not the column — sets the body's reading width (--container-site
            − 2×padding − 2×border). At 6 that lands on ~750px; at 8 it would drop to ~734px. */}
        <div className='rounded-lg border border-zinc-200 bg-white px-4 py-6 dark:border-zinc-800 dark:bg-zinc-900 sm:px-6 sm:py-8'>
          {showToc && <TocNavMobile toc={toc} />}
          <div
            id='post-body'
            className='prose prose-zinc dark:prose-invert max-w-none'
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
        {/* Client enhancer: injects a copy button into each code block after mount. The body
            above stays server-rendered; this only adds the interactive control. */}
        <CodeCopyButtons targetId='post-body' />
      </div>
      {showToc && <TocNavDesktop toc={toc} />}
    </article>
  );
}
