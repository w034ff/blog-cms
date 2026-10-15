import Link from 'next/link';
import { LIBRARY_TABS, libraryHref, type LibraryTab } from '@/lib/admin-post-list';
import { TAB_LABELS } from './constants';

// The tabs on /admin/library (docs/library-requirements.md §6.2).
// Underlined with the accent color when selected, matching ListControls' status tabs.
export function LibraryTabs({
  currentTab,
  counts,
}: {
  currentTab: LibraryTab;
  counts: Record<LibraryTab, number>;
}) {
  return (
    <div className='mb-3 flex flex-wrap-reverse items-end justify-between gap-x-6 gap-y-2 border-b border-zinc-300 dark:border-zinc-700'>
      <nav
        aria-label='ライブラリ'
        className='-mb-px flex max-w-full gap-6 overflow-x-auto [scrollbar-width:none]'>
        {LIBRARY_TABS.map((tab) => {
          const current = currentTab === tab;
          const label = TAB_LABELS[tab];
          return (
            <Link
              key={tab}
              href={libraryHref(tab)}
              aria-current={current ? 'page' : undefined}
              className={`border-b-3 py-2 text-base whitespace-nowrap ${
                current
                  ? 'border-(--accent) font-semibold text-zinc-900 dark:text-zinc-50'
                  : 'border-transparent text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50'
              }`}>
              {label}
              <span className='ml-1.5 text-xs font-normal text-zinc-500'>
                {counts[tab].toLocaleString('en-US')}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
