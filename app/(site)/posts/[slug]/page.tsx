import { notFound } from 'next/navigation';
import { resolveCard } from '@/lib/resolve-card';
import { PostArticle } from '@/components/PostArticle';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getDraftBySlug, getPostBySlug } from '@/lib/posts';
import { getOptionalSession } from '@/lib/dal';
import { renderMdxToHtml } from '@/lib/render';
import type { Post } from '@/lib/types';
import { resolveThumbnail } from '@/lib/thumbnail';
import { excerptFromBody } from '@/lib/excerpt';
import { sharedOpenGraph } from '@/app/shared-metadata';

type Params = { slug: string };

export const dynamic = 'force-dynamic';

// What this URL serves, and to whom. A published post (unlisted included — its slug is its only
// gate) answers everyone. A draft answers nobody, unless the request carries an admin session, and
// then it is a preview: same URL, same rendering path, so what the author checks is literally what
// will ship rather than a second implementation of it.
//
// The session is the credential, not the URL. That is the difference from 限定公開, where knowing
// the address is enough — a leaked draft address still 404s.
//
// `getOptionalSession` and not `verifySession`: this route must refuse, not redirect to /login. A
// stranger who guesses a draft's slug learns nothing, including that it exists.
//
// Asked only when the published lookup misses, so an ordinary read of an ordinary post pays one
// query and no cookie parse.
async function readablePost(slug: string): Promise<{ post: Post; preview: boolean } | null> {
  const published = await getPostBySlug(slug);
  if (published) return { post: published, preview: false };
  if (!(await getOptionalSession())) return null;
  const draft = await getDraftBySlug(slug);
  return draft ? { post: draft, preview: true } : null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const readable = await readablePost(slug);
  if (!readable) return {};
  const { post, preview } = readable;
  // A preview says so in the tab, because the page it is previewing will look identical there.
  if (preview) {
    // Explicit, not inherited. The site is noindex-wide today; that flag goes when it opens up,
    // and an unpublished post must not become indexable on the day it does.
    return { title: `[下書き] ${post.title}`, robots: { index: false, follow: false } };
  }
  const thumbnail = resolveThumbnail(post);
  // The body's opening (lib/excerpt.ts). A post with no prose at all leaves it unset, so the
  // layout's site description stands in rather than an empty tag.
  const description = excerptFromBody(post.body) || undefined;
  return {
    title: post.title,
    description,
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
      description,
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
  const readable = await readablePost(slug);
  if (!readable) notFound();
  const { post, preview } = readable;

  // resolveCard is handed over unchanged, so a link card inside a draft still resolves through
  // `getPostBySlug` — a card pointing at another draft renders as a plain link here exactly as it
  // would for a reader. The preview shows what will ship, and that includes what will not resolve.
  const { html, toc } = await renderMdxToHtml(post.body, { resolveCard });

  return (
    <>
      {/* A preview is otherwise indistinguishable from the live post — same URL, same markup —
          and mistaking one for the other is the whole failure mode of previewing in place. So the
          banner is the feature, not decoration around it: it carries the one piece of information
          the same-URL design throws away.

          Which is also why it says only that. It used to spell out that the post is unpublished
          and that the URL answers nobody else — true, but read once and noise thereafter, to an
          author who already knows how their own editor works. 下書きのプレビュー is the whole
          claim; the link is the next thing an author wants. Outside the <article>, because it is
          not part of the post. */}
      {preview && (
        <div
          role='status'
          className='mx-auto mb-6 flex max-w-site flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'>
          <b className='font-semibold'>下書きのプレビュー</b>
          <Link
            href={`/admin/posts/${post.id}/edit`}
            className='shrink-0 font-medium underline underline-offset-2'>
            編集に戻る
          </Link>
        </div>
      )}
      <PostArticle post={post} html={html} toc={toc} />
    </>
  );
}
