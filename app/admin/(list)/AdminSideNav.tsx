'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/actions/auth';

type Item = { label: string; href: string; current: (pathname: string) => boolean };

const ARTICLES: Item = {
  label: '記事一覧',
  href: '/admin',
  current: (pathname) => pathname === '/admin',
};
const TAGS: Item = {
  label: 'タグの管理',
  href: '/admin/tags',
  current: (pathname) => pathname.startsWith('/admin/tags'),
};

const itemClass = 'block shrink-0 px-3 py-2 text-sm whitespace-nowrap';

// The current screen carries a 3px accent bar, as the post page's ToC marks its current entry
// (globals.css `.toc-rail`): on the rail's left from `md`, under the tab in the row below it. The
// content beside it is the white sheet, so the marker is not one.
const currentClass =
  'border-b-3 border-(--accent) font-semibold text-zinc-900 md:-ml-0.5 md:border-b-0 md:border-l-3 dark:text-zinc-50';
const otherClass =
  'border-b-3 border-transparent text-zinc-600 hover:text-zinc-950 md:-ml-0.5 md:border-b-0 md:border-l-3 dark:text-zinc-400 dark:hover:text-zinc-50';

// The management screens' own navigation, beside the content from `md` and a scrolling row above
// it below that. タグの管理 is passed in rather than read here: whether the account is an admin is
// the database's answer (lib/dal.ts isAdmin), and the page behind it 404s for an author anyway.
export function AdminSideNav({ showTags }: { showTags: boolean }) {
  const pathname = usePathname();
  const items = showTags ? [ARTICLES, TAGS] : [ARTICLES];

  return (
    <nav
      aria-label='管理'
      className='mb-6 flex items-end gap-1 overflow-x-auto md:mb-0 md:w-44 md:shrink-0 md:flex-col md:items-stretch md:gap-0 md:overflow-visible'>
      <ul className='flex items-end gap-1 md:flex-col md:items-stretch md:gap-0 md:border-l md:border-zinc-300 md:dark:border-zinc-700'>
        {items.map((item) => {
          const current = item.current(pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={`${itemClass} ${current ? currentClass : otherClass}`}>
                {item.label}
              </Link>
            </li>
          );
        })}
        {/* No page yet: shown so the menu's shape can be judged, and not a link, so it leads
            nowhere. */}
        <li>
          <span
            aria-disabled='true'
            className={`${itemClass} border-b-3 border-transparent text-zinc-400 md:-ml-0.5 md:border-b-0 md:border-l-3 dark:text-zinc-600`}>
            統計<span className='ml-2 text-xs'>準備中</span>
          </span>
        </li>
      </ul>
      <form action={logout} className='ml-auto shrink-0 md:mt-6 md:ml-0'>
        <button type='submit' className={`${itemClass} ${otherClass}`}>
          ログアウト
        </button>
      </form>
    </nav>
  );
}
