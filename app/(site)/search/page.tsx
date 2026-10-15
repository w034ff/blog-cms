import type { Metadata } from 'next';
import Link from 'next/link';
import { KindBadge } from '@/components/KindBadge';
import { formatPostDate } from '@/lib/format';
import { getSearchablePosts } from '@/lib/posts';
import { searchPosts, type MarkSegment } from '@/lib/search';

// Named constants for UI labels, search messages, and metadata (docs/search-requirements.md §4).
const PAGE_HEADING = '検索';
const SEARCH_INPUT_LABEL = '検索キーワード';
const SEARCH_INPUT_PLACEHOLDER = 'キーワードを入力';
const SEARCH_BUTTON_LABEL = '検索';
const SEARCH_RESULTS_PREFIX = '「';
const SEARCH_RESULTS_SUFFIX_FOUND = '」を含む記事と走り書き';
const SEARCH_RESULTS_UNIT = '件';
const SEARCH_RESULTS_EMPTY_SUFFIX = '」を含む記事と走り書きはありません。';
const SEARCH_METADATA_TITLE_DEFAULT = '検索';
const SEARCH_METADATA_TITLE_PREFIX = '「';
const SEARCH_METADATA_TITLE_SUFFIX = '」の検索結果';

type SearchPageParams = {
  q?: string | string[];
};

export const dynamic = 'force-dynamic';

function extractQueryParam(param: string | string[] | undefined): string {
  if (typeof param === 'string') return param;
  if (Array.isArray(param) && typeof param[0] === 'string') return param[0];
  return '';
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchPageParams>;
}): Promise<Metadata> {
  const resolved = await searchParams;
  const q = extractQueryParam(resolved.q).trim();
  const title = q
    ? `${SEARCH_METADATA_TITLE_PREFIX}${q}${SEARCH_METADATA_TITLE_SUFFIX}`
    : SEARCH_METADATA_TITLE_DEFAULT;

  return {
    title,
    robots: { index: false },
  };
}

// Render text segments safely without dangerouslySetInnerHTML (docs/search-requirements.md §4).
function MarkedText({ segments }: { segments: readonly MarkSegment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.isMark ? (
          <mark key={i} className='bg-(--search-mark-bg) text-(--search-mark-fg) rounded-xs px-0.5'>
            {seg.text}
          </mark>
        ) : (
          seg.text
        ),
      )}
    </>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchPageParams>;
}) {
  const resolved = await searchParams;
  const rawQ = extractQueryParam(resolved.q);
  const trimmedQ = rawQ.trim();
  const hasQuery = trimmedQ.length > 0;

  const searchablePosts = hasQuery ? await getSearchablePosts() : [];
  const results = hasQuery ? searchPosts(searchablePosts, trimmedQ) : [];

  return (
    <section className='mx-auto w-full max-w-page'>
      <h1 className='text-3xl font-bold tracking-tight'>{PAGE_HEADING}</h1>

      <form method='get' action='/search' className='mt-6 flex max-w-lg gap-2'>
        <input
          type='search'
          name='q'
          defaultValue={rawQ}
          autoFocus={!hasQuery}
          aria-label={SEARCH_INPUT_LABEL}
          placeholder={SEARCH_INPUT_PLACEHOLDER}
          className='min-w-0 flex-1 rounded-box border border-zinc-300 bg-surface px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-hidden dark:border-zinc-700 dark:text-zinc-50 dark:focus:border-zinc-100'
        />
        <button type='submit' className='button-primary shrink-0 px-4 py-2 text-sm font-medium'>
          {SEARCH_BUTTON_LABEL}
        </button>
      </form>

      {hasQuery && (
        <div className='mt-6'>
          <p className='text-sm text-zinc-600 dark:text-zinc-400'>
            {results.length > 0
              ? `${SEARCH_RESULTS_PREFIX}${trimmedQ}${SEARCH_RESULTS_SUFFIX_FOUND} ${results.length} ${SEARCH_RESULTS_UNIT}`
              : `${SEARCH_RESULTS_PREFIX}${trimmedQ}${SEARCH_RESULTS_EMPTY_SUFFIX}`}
          </p>

          {results.length > 0 && (
            <ol className='mt-4 divide-y divide-zinc-200 dark:divide-zinc-800'>
              {results.map(({ post, titleSegments, snippetSegments }) => {
                const href =
                  post.kind === 'scribble' ? `/scribbles/${post.slug}` : `/posts/${post.slug}`;
                return (
                  <li key={post.id} className='py-4'>
                    <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-600 dark:text-zinc-400'>
                      <KindBadge kind={post.kind} />
                      {post.date && (
                        <time dateTime={post.date} className='whitespace-nowrap'>
                          公開 {formatPostDate(post.date)}
                        </time>
                      )}
                    </div>
                    <h2 className='mt-1 text-base font-semibold tracking-tight'>
                      <Link href={href} className='hover:underline break-words'>
                        <MarkedText segments={titleSegments} />
                      </Link>
                    </h2>
                    {snippetSegments.length > 0 && (
                      <p className='mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400 break-words'>
                        <MarkedText segments={snippetSegments} />
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
