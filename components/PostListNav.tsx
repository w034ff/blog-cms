import Link from 'next/link';
import { CATEGORIES, type CategoryId } from '@/lib/content';
import { postListPageHref } from '@/lib/post-list';

export const ALL_POSTS_TAB_LABEL = 'すべて';

// The tabs over the home page and the category pages (docs/home-requirements.md §2). Links, not a
// filter: すべて is `/` and each category is its own `/categories/<id>`, so one list has one URL.
// They stand above the pinned post, which only すべて shows, so switching tabs never moves them. The
// tab names the page, so the page has no visible heading of its own repeating it (§2).
export function CategoryTabs({ active }: { active: CategoryId | null }) {
  const tabs = [
    { key: 'all', label: ALL_POSTS_TAB_LABEL, href: '/', current: active === null },
    ...CATEGORIES.map((category) => ({
      key: category.id,
      label: category.label,
      href: `/categories/${category.id}`,
      current: active === category.id,
    })),
  ];
  return (
    <nav
      aria-label='カテゴリ'
      className='mb-6 flex gap-6 border-b border-zinc-300 dark:border-zinc-700'>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.current ? 'page' : undefined}
          className={`-mb-px border-b-2 pb-2 text-sm font-semibold ${
            tab.current
              ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
              : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
          }`}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

// ← 新しい記事 / 古い記事 →, the scribble list's pair (app/(site)/scribbles/page.tsx) in the post
// lists' words. Nothing is drawn when the list fits on one page.
export function PostListPager({
  basePath,
  page,
  totalPages,
}: {
  basePath: string;
  page: number;
  totalPages: number;
}) {
  if (page <= 1 && page >= totalPages) return null;
  const linkClass = 'text-sm font-medium text-zinc-600 hover:underline dark:text-zinc-400';
  return (
    <nav aria-label='ページ移動' className='mt-8 flex justify-between'>
      <div>
        {page > 1 && (
          <Link href={postListPageHref(basePath, page - 1)} className={linkClass}>
            ← 新しい記事
          </Link>
        )}
      </div>
      <div>
        {page < totalPages && (
          <Link href={postListPageHref(basePath, page + 1)} className={linkClass}>
            古い記事 →
          </Link>
        )}
      </div>
    </nav>
  );
}
