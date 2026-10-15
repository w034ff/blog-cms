import Link from 'next/link';
import { CATEGORIES } from '@/lib/content';
import { DEFAULT_PARAMS, listHref, type ListParams, type Status } from '@/lib/admin-post-list';
import { OptionMenu } from './OptionMenu';

const TABS: { status: Status; label: string }[] = [
  { status: 'all', label: 'すべて' },
  { status: 'published', label: '公開中' },
  { status: 'working', label: '作業中' },
];

// The title search, full width under the heading since it is the control most reached for, then
// the status tabs with their counts and the category and sort menus beside them. The current tab
// carries the accent bar, under its label. The search is a GET form, so it needs no script; the
// other parameters ride along as hidden fields. `flex-wrap-reverse`: when the row is too narrow,
// the menus go above the tabs, so the tabs' bar stays on the line under them.
export function ListControls({
  params,
  counts,
  basePath = '/admin',
  showCategory = true,
}: {
  params: ListParams;
  counts: Record<Status, number>;
  basePath?: string;
  showCategory?: boolean;
}) {
  return (
    <>
      <form action={basePath} role='search' className='relative mb-3'>
        {params.status !== DEFAULT_PARAMS.status && (
          <input type='hidden' name='status' value={params.status} />
        )}
        {params.sort !== DEFAULT_PARAMS.sort && (
          <input type='hidden' name='sort' value={params.sort} />
        )}
        {showCategory && params.category !== null && (
          <input type='hidden' name='category' value={params.category} />
        )}
        <svg
          aria-hidden='true'
          viewBox='0 0 16 16'
          className='pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500'>
          <circle cx='7' cy='7' r='4.5' fill='none' stroke='currentColor' strokeWidth='1.5' />
          <path d='M10.5 10.5L14 14' stroke='currentColor' strokeWidth='1.5' />
        </svg>
        <input
          type='search'
          name='q'
          defaultValue={params.q}
          placeholder='タイトルで検索'
          aria-label='タイトルで検索'
          className='w-full rounded-box border border-zinc-300 bg-surface py-2 pr-3 pl-9 text-base focus:ring-2 focus:ring-zinc-400 focus:outline-none dark:border-zinc-700'
        />
      </form>
      <div className='mb-3 flex flex-wrap-reverse items-end justify-between gap-x-6 gap-y-2 border-b border-zinc-300 dark:border-zinc-700'>
        {/* Scrolls sideways rather than run off a narrow phone when the counts grow; no scrollbar,
            which would sit on the underline. */}
        <nav
          aria-label='状態'
          className='-mb-px flex max-w-full gap-6 overflow-x-auto [scrollbar-width:none]'>
          {TABS.map(({ status, label }) => {
            const current = params.status === status;
            return (
              <Link
                key={status}
                href={listHref(basePath, params, { status })}
                aria-current={current ? 'page' : undefined}
                className={`border-b-3 py-2 text-base whitespace-nowrap ${
                  current
                    ? 'border-(--accent) font-semibold text-zinc-900 dark:text-zinc-50'
                    : 'border-transparent text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50'
                }`}>
                {label}
                <span className='ml-1.5 text-xs font-normal text-zinc-500'>
                  {counts[status].toLocaleString('en-US')}
                </span>
              </Link>
            );
          })}
        </nav>
        <div className='flex items-center gap-4 pb-2'>
          {showCategory && (
            <OptionMenu
              label='カテゴリ'
              options={[
                {
                  label: 'すべてのカテゴリ',
                  href: listHref(basePath, params, { category: null }),
                  current: params.category === null,
                },
                ...CATEGORIES.map(({ id, label }) => ({
                  label,
                  href: listHref(basePath, params, { category: id }),
                  current: params.category === id,
                })),
              ]}
            />
          )}
          <OptionMenu
            label='並び替え'
            options={[
              {
                label: '編集の新しい順',
                href: listHref(basePath, params, { sort: 'edited' }),
                current: params.sort === 'edited',
              },
              {
                label: '公開日の新しい順',
                href: listHref(basePath, params, { sort: 'published' }),
                current: params.sort === 'published',
              },
            ]}
          />
        </div>
      </div>
    </>
  );
}
