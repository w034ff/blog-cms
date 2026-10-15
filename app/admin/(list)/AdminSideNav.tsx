'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/actions/auth';

export type Item = { label: string; href: string; current: (pathname: string) => boolean };

export const ARTICLES: Item = {
  label: '記事一覧',
  href: '/admin',
  current: (pathname) => pathname === '/admin',
};
export const SCRIBBLES: Item = {
  label: '走り書き',
  href: '/admin/scribbles',
  current: (pathname) => pathname.startsWith('/admin/scribbles'),
};
export const TAGS: Item = {
  label: 'タグの管理',
  href: '/admin/tags',
  current: (pathname) => pathname.startsWith('/admin/tags'),
};

// 16px, the size of the list's titles, so the menu reads at the content's weight.
const itemClass = 'block px-3.5 py-2.5 text-base whitespace-nowrap';

// The current screen carries a 3px accent bar on the rail, as the post page's ToC marks its current
// entry (globals.css `.toc-rail`). The content beside it is the white sheet, so the marker is not one.
const currentClass =
  '-ml-0.5 border-l-3 border-(--accent) font-semibold text-zinc-900 dark:text-zinc-50';
const otherClass =
  '-ml-0.5 border-l-3 border-transparent text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50';

// The management screens' own navigation, a rail beside the content from `md`. Below that the
// screen's heading opens the same items instead (ScreenHeading): not a row of tabs, since 記事一覧
// has its own status tabs under the heading, and two rows of underlined tabs read as one control.
// タグの管理 is passed in rather than read here: whether the account is an admin is the database's
// answer (lib/dal.ts isAdmin), and the page behind it 404s for an author anyway.
export function AdminSideNav({ showTags }: { showTags: boolean }) {
  const pathname = usePathname();
  const items = showTags ? [ARTICLES, SCRIBBLES, TAGS] : [ARTICLES, SCRIBBLES];

  return (
    <nav aria-label='管理' className='hidden w-44 shrink-0 flex-col md:flex'>
      <ul className='border-l border-zinc-300 dark:border-zinc-700'>
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
            className={`${itemClass} -ml-0.5 border-l-3 border-transparent text-zinc-400 dark:text-zinc-600`}>
            統計<span className='ml-2 text-xs'>準備中</span>
          </span>
        </li>
      </ul>
      <form action={logout} className='mt-6'>
        <button type='submit' className={`${itemClass} ${otherClass}`}>
          ログアウト
        </button>
      </form>
    </nav>
  );
}
