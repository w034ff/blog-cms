import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getPostBySlug } from '@/lib/posts';
import { readLinkPreview } from '@/lib/link-previews';
import { linkImageSrc } from '@/lib/link-image';
import { normalizeCardHref } from '@/lib/link-card-href';
import { externalCardImage, internalCardImage } from '@/lib/link-card-image';
import { siteOrigin } from '@/lib/site';
import { renderMdxToHtml, type CardTarget } from '@/lib/render';
import { formatPostDate } from '@/lib/format';
import { resolveThumbnail } from '@/lib/thumbnail';
import { CodeCopyButtons } from '@/components/CodeCopyButtons';
import { FootnotePopover } from '@/components/FootnotePopover';
import { TocNavMobile, TocNavDesktop } from '@/components/TocNav';
import { sharedOpenGraph } from '@/app/shared-metadata';

type Params = { slug: string };

// Below this, a table of contents is more clutter than aid (see the design discussion this
// pins: a 1-2 heading post has nothing worth jumping around for).
const MIN_HEADINGS_FOR_TOC = 3;

export const dynamic = 'force-dynamic';

// The DB half of a link card. It lives here, not in lib/render.ts, so the render pipeline keeps
// no dependency on `posts` (docs/link-card-requirements.md §6) — the stage is handed this closure
// and knows nothing about where a title comes from.
//
// The href has already been validated by the stage before it gets here, so it is one of exactly
// two shapes and `/posts/` tells them apart (§14.2). Which table answers is the only difference:
// this blog's posts are read live, an external page's title is read from what the editor stored.
//
// **Neither branch fetches.** `readLinkPreview` is a SELECT; there is no path from a reader's
// request to another server (§14.1). A URL the editor has never resolved has no row, which is the
// same `null` a draft or an unknown slug produces, and the stage renders a plain link for all of
// them (§6.1).
async function resolveCard(href: string): Promise<CardTarget | null> {
  // A reference written by hand can be this blog's own published URL, which no entry point would
  // produce (§14.5.1) and which has no `link_previews` row to find — the editor's route refuses to
  // fetch this server. Rewritten to the internal reference here for the same reason it is rewritten
  // there, so the two surfaces resolve a stored card the same way. The `<a href>` is untouched: it
  // is what the author wrote, and it goes where it says.
  const reference = normalizeCardHref(href, siteOrigin.origin) ?? href;
  if (!reference.startsWith('/posts/')) {
    const preview = await readLinkPreview(reference);
    if (!preview) return null;
    // The target's own picture, but served from here: `linkImageSrc` signs a path into
    // /api/link-image, so the reader's browser asks this site for it and the target's CDN never
    // sees the reader (§14.4). Deriving the path here rather than storing it means the signing key
    // can change without rewriting a single row.
    return {
      ...preview,
      image: externalCardImage(preview.image ? linkImageSrc(preview.image) : null),
    };
  }
  const target = await getPostBySlug(reference.slice('/posts/'.length));
  if (!target) return null;
  // resolveThumbnail, not `target.thumbnail`: the card shows the same image the
  // post list does, including the body-derived fallback. It is also the only
  // thing standing between a bad stored value and an `<img src>`, since the
  // rehype stage trusts what this returns.
  //
  // `internalCardImage` is what turns its `null` — a post with no picture at all
  // — into this site's own mark (§17). It is not folded into `resolveThumbnail`
  // because that answer also becomes `og:image` and is checked against the
  // uploads sweep; the fallback belongs to the card, and the editor's card
  // reaches the same function through `/api/posts/search`.
  return {
    title: target.title,
    description: target.description,
    image: internalCardImage(resolveThumbnail(target)),
  };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};
  const thumbnail = resolveThumbnail(post);
  return {
    title: post.title,
    description: post.description,
    openGraph: {
      // Spread, not replaced: setting `openGraph` here overrides the layout's
      // object wholesale, so siteName and locale have to come along or this one
      // page quietly loses them (see app/shared-metadata.ts).
      ...sharedOpenGraph,
      // The post's own image when it has one, otherwise the site card the spread
      // above supplies. Declared without width/height, unlike /og.png: these are
      // author uploads of unknown dimensions, and a wrong declared size is worse
      // than none — a consumer laying the card out from it gets a distorted box.
      //
      // A relative path, resolved against metadataBase like `url` below. og:image
      // must be absolute in the emitted tag, and metadataBase is what makes that
      // one host, from SITE_ORIGIN, rather than something baked in here.
      ...(thumbnail ? { images: [{ url: thumbnail, alt: post.title }] } : {}),
      type: 'article',
      title: post.title,
      description: post.description,
      // Relative, resolved against metadataBase — the canonical address of the
      // post, so a share from a proxied or query-decorated URL still points here.
      url: `/posts/${slug}`,
      // The publish date, which is immutable once set (lib/posts-write.ts). Stored
      // UTC; the tag wants ISO 8601 and a bare YYYY-MM-DD is valid as one.
      publishedTime: post.date,
    },
  };
}

export default async function PostPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const { html, toc } = await renderMdxToHtml(post.body, { resolveCard });
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
        {/* Client enhancers: both attach behaviour to the server-rendered body after mount and
            render nothing themselves — a copy button on each code block, and a preview of the note
            behind each footnote reference (which stays a working anchor either way). */}
        <CodeCopyButtons targetId='post-body' />
        <FootnotePopover targetId='post-body' />
      </div>
      {showToc && <TocNavDesktop toc={toc} />}
    </article>
  );
}
