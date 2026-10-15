import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CodeCopyButtons } from '@/components/CodeCopyButtons';
import { ImageZoom } from '@/components/ImageZoom';
import { ScribbleCardBody } from '@/components/ScribbleCardBody';
import { formatScribbleDate } from '@/lib/format';
import { countScribbles, getScribbles } from '@/lib/posts';
import { renderMdxToHtml } from '@/lib/render';
import { resolveCard } from '@/lib/resolve-card';
import {
  calculateTotalPages,
  parsePageNumber,
  scribbleListMetadata,
  SCRIBBLES_PER_PAGE,
} from '@/lib/scribble-list';

type SearchParams = {
  page?: string | string[];
};

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const resolved = await searchParams;
  const page = parsePageNumber(resolved.page);
  return scribbleListMetadata(page);
}

export default async function ScribblesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolved = await searchParams;
  const page = parsePageNumber(resolved.page);
  const total = await countScribbles();
  const totalPageCount = calculateTotalPages(total, SCRIBBLES_PER_PAGE);

  if (page > totalPageCount) {
    notFound();
  }

  const offset = (page - 1) * SCRIBBLES_PER_PAGE;
  const scribbles = await getScribbles({ limit: SCRIBBLES_PER_PAGE, offset });

  const renderedScribbles = await Promise.all(
    scribbles.map(async (post) => {
      const { html } = await renderMdxToHtml(post.body, {
        resolveCard,
        embedsAsLinks: true,
        fragmentBase: `/scribbles/${post.slug}`,
      });
      return { post, html };
    }),
  );

  return (
    <section className='mx-auto w-full max-w-page'>
      <header className='mb-8'>
        <h1 className='text-3xl font-bold tracking-tight'>走り書き</h1>
        <p className='mt-2 text-zinc-600 dark:text-zinc-400'>記事にするほどではない、短いメモ。</p>
      </header>

      {renderedScribbles.length === 0 ? (
        <p className='text-zinc-600 dark:text-zinc-400'>まだ走り書きがありません。</p>
      ) : (
        <>
          <ol className='relative'>
            {renderedScribbles.map(({ post, html }, index) => {
              const isLast = index === renderedScribbles.length - 1;
              const { year, monthDay } = formatScribbleDate(post.date);
              const targetId = `scribble-body-${post.slug}`;
              return (
                <li
                  key={post.slug}
                  className={`relative flex gap-3 sm:gap-6 ${isLast ? '' : 'pb-8'}`}>
                  {/* Date column */}
                  <div className='w-12 shrink-0 pt-5 text-right sm:w-16 sm:pt-6'>
                    <time
                      dateTime={post.date}
                      className='flex flex-col text-zinc-500 dark:text-zinc-400'>
                      <span className='font-mono text-xs'>{year}</span>
                      <span className='font-mono text-sm font-semibold text-zinc-700 dark:text-zinc-300'>
                        {monthDay}
                      </span>
                    </time>
                  </div>

                  {/* Vertical line: does not extend downwards on the last row */}
                  <div className='relative flex justify-center'>
                    <div
                      className={`w-px bg-zinc-200 dark:bg-zinc-800 ${isLast ? 'h-full' : 'absolute inset-y-0'}`}
                    />
                  </div>

                  {/* White card */}
                  <article className='min-w-0 flex-1 rounded-panel border border-zinc-200 bg-surface p-5 sm:p-6 dark:border-zinc-800'>
                    <header>
                      <Link href={`/scribbles/${post.slug}`} className='group'>
                        <h2 className='text-xl font-semibold tracking-tight group-hover:underline sm:text-2xl'>
                          {post.title}
                        </h2>
                      </Link>
                    </header>
                    <ScribbleCardBody html={html} slug={post.slug} targetId={targetId} />
                    {post.tagList.length > 0 && (
                      <ul className='mt-4 flex flex-wrap gap-2'>
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
                  </article>
                  <CodeCopyButtons targetId={targetId} />
                  <ImageZoom targetId={targetId} />
                </li>
              );
            })}
          </ol>

          {(page > 1 || page < totalPageCount) && (
            <nav aria-label='ページ移動' className='mt-8 flex justify-between'>
              <div>
                {page > 1 && (
                  <Link
                    href={page === 2 ? '/scribbles' : `/scribbles?page=${page - 1}`}
                    className='text-sm font-medium text-zinc-600 hover:underline dark:text-zinc-400'>
                    ← 新しい走り書き
                  </Link>
                )}
              </div>
              <div>
                {page < totalPageCount && (
                  <Link
                    href={`/scribbles?page=${page + 1}`}
                    className='text-sm font-medium text-zinc-600 hover:underline dark:text-zinc-400'>
                    古い走り書き →
                  </Link>
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
