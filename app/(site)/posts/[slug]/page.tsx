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

// A published post (unlisted included) answers everyone. A draft answers only an admin session, as a
// preview on the same URL and rendering path, so what the author checks is what will ship.
// `getOptionalSession`, not `verifySession`: a stranger gets a 404, not a /login redirect revealing
// that the draft exists. Asked only on a published miss, so an ordinary read parses no cookie.
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
      // Spread, not replaced: `openGraph` here replaces the layout's wholesale
      // (app/shared-metadata.ts).
      ...sharedOpenGraph,
      // Without width/height, unlike /og.png: uploads are of unknown size, and a wrong one distorts
      // the card. Relative; metadataBase (SITE_ORIGIN) makes it absolute.
      ...(thumbnail ? { images: [{ url: thumbnail, alt: post.title }] } : {}),
      type: 'article',
      title: post.title,
      description,
      // The canonical address, resolved against metadataBase.
      url: `/posts/${slug}`,
      // Immutable once set (lib/posts-write.ts); ISO 8601, UTC.
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
      {/* Without this banner a preview is indistinguishable from the live post, so it is the
          feature, not decoration. Outside the <article>: it is not part of the post. */}
      {preview && (
        <div
          role='status'
          className='mx-auto mb-6 flex max-w-page flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-box border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'>
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
