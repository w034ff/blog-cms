'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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
export const LIBRARY: Item = {
  label: 'ライブラリ',
  href: '/admin/library',
  current: (pathname) => pathname.startsWith('/admin/library'),
};
export const TAGS: Item = {
  label: 'タグの管理',
  href: '/admin/tags',
  current: (pathname) => pathname.startsWith('/admin/tags'),
};

export const USERS: Item = {
  label: '利用者',
  href: '/admin/users',
  current: (pathname) => pathname.startsWith('/admin/users'),
};

export const SETTINGS: Item = {
  label: 'サイトの設定',
  href: '/admin/settings',
  current: (pathname) => pathname.startsWith('/admin/settings'),
};

// The menu's groups in order, shared with ScreenHeading so the rail and the narrow screen's menu
// cannot disagree. The first is every account's own work, the second the site's management, only for
// an admin (docs/multi-author-requirements.md §11): an author's menu is the first group alone, the
// same shape an admin sees above the break.
export function adminNavGroups(admin: boolean): Item[][] {
  const own = [ARTICLES, SCRIBBLES, LIBRARY];
  return admin ? [own, [TAGS, USERS, SETTINGS]] : [own];
}

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
// Whether the account is an admin is passed in rather than read here: it is the database's answer
// (lib/dal.ts isAdmin), and the pages behind the admin's group 404 for an author anyway.
// The groups are separate runs of the rail with a gap between them, not a rule across it: a
// horizontal line would meet the rail and the current item's accent bar at a joint.
export function AdminSideNav({ admin }: { admin: boolean }) {
  const pathname = usePathname();
  const groups = adminNavGroups(admin);

  return (
    <nav aria-label='管理' className='hidden w-44 shrink-0 flex-col gap-4 md:flex'>
      {groups.map((group, index) => (
        <ul key={group[0].href} className='border-l border-zinc-300 dark:border-zinc-700'>
          {group.map((item) => {
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
              nowhere. It ends the first group, since every account will have its own figures. */}
          {index === 0 && (
            <li>
              <span
                aria-disabled='true'
                className={`${itemClass} -ml-0.5 border-l-3 border-transparent text-zinc-400 dark:text-zinc-600`}>
                統計<span className='ml-2 text-xs'>準備中</span>
              </span>
            </li>
          )}
        </ul>
      ))}
    </nav>
  );
}
