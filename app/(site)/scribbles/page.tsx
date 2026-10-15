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
      <h1 className='mb-8 text-3xl font-bold tracking-tight'>走り書き</h1>

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
                <li key={post.slug} className='flex gap-4'>
                  {/* The date over a line that runs on to the next entry. The year stays, unlike the
                      mock-up's month/day alone, so a timeline that crosses a year still reads. */}
                  <div className='flex w-14 shrink-0 flex-col items-center'>
                    <time
                      dateTime={post.date}
                      className='flex flex-col items-center font-mono leading-tight text-(--chip-fg)'>
                      <span className='text-[11px]'>{year}</span>
                      <span className='text-[13px] font-medium'>{monthDay}</span>
                    </time>
                    {!isLast && (
                      <div aria-hidden='true' className='mt-2 w-0.5 flex-1 bg-(--chip-bg-hover)' />
                    )}
                  </div>

                  <article className='mb-4 min-w-0 flex-1 rounded-panel border border-zinc-200 bg-surface px-5 py-4 dark:border-zinc-800'>
                    <header>
                      <Link href={`/scribbles/${post.slug}`} className='group'>
                        <h2 className='mb-2 text-[17px] leading-snug font-bold group-hover:underline'>
                          {post.title}
                        </h2>
                      </Link>
                    </header>
                    <ScribbleCardBody html={html} slug={post.slug} targetId={targetId} />
                    {post.tagList.length > 0 && (
                      <ul className='mt-3 flex flex-wrap gap-2'>
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
