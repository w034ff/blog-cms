'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { logout } from '@/app/actions/auth';
import { SiteMark } from '@/components/SiteMark';
import { useDismiss } from '@/components/editor/useDismiss';
import { getSiteSection, getInitialLetter } from '@/lib/site-section';

// Named constants for UI strings and route paths (docs/site-header-requirements.md §3).
const NAV_ARTICLES_LABEL = '記事';
const NAV_SCRIBBLES_LABEL = '走り書き';
const NAV_SCRIBBLES_HREF = '/scribbles';

const ARTICLES_MENU_LATEST_LABEL = '最新の記事';
const ARTICLES_MENU_LATEST_HREF = '/';
const ARTICLES_MENU_CATEGORIES_LABEL = 'カテゴリ';
const ARTICLES_MENU_CATEGORIES_HREF = '/categories';
const ARTICLES_MENU_TAGS_LABEL = 'タグ';
const ARTICLES_MENU_TAGS_HREF = '/tags';
const ARTICLES_MENU_SEARCH_LABEL = '検索';
const ARTICLES_MENU_SEARCH_HREF = '/search';

const POST_BUTTON_LABEL = '投稿する';
const POST_MENU_ARTICLE_LABEL = '記事';
const POST_MENU_ARTICLE_HREF = '/admin/posts/new';
const POST_MENU_SCRIBBLE_LABEL = '走り書き';
const POST_MENU_SCRIBBLE_HREF = '/admin/posts/new?kind=scribble';

const ACCOUNT_MENU_BUTTON_LABEL = 'アカウントのメニュー';
const ACCOUNT_MENU_LOGGED_IN_SUFFIX = 'でログイン中';
const ACCOUNT_MENU_LIBRARY_LABEL = 'ライブラリ';
const ACCOUNT_MENU_LIBRARY_HREF = '/admin/library';
const ACCOUNT_MENU_ADMIN_LABEL = '管理画面';
const ACCOUNT_MENU_ADMIN_HREF = '/admin';
const ACCOUNT_MENU_LOGOUT_LABEL = 'ログアウト';

type MenuItem = {
  readonly label: string;
  readonly href: string;
  readonly icon?: ReactNode;
};

const ARTICLES_MENU_ITEMS: readonly MenuItem[] = [
  { label: ARTICLES_MENU_LATEST_LABEL, href: ARTICLES_MENU_LATEST_HREF },
  { label: ARTICLES_MENU_CATEGORIES_LABEL, href: ARTICLES_MENU_CATEGORIES_HREF },
  { label: ARTICLES_MENU_TAGS_LABEL, href: ARTICLES_MENU_TAGS_HREF },
];

const ARTICLES_SEARCH_MENU_ITEM: MenuItem = {
  label: ARTICLES_MENU_SEARCH_LABEL,
  href: ARTICLES_MENU_SEARCH_HREF,
  icon: (
    <svg aria-hidden='true' viewBox='0 0 16 16' className='h-3.5 w-3.5 shrink-0'>
      <path
        d='M11 6.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zm-1.3 3.2 3.8 3.8'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.8'
        strokeLinecap='round'
      />
    </svg>
  ),
};

const POST_MENU_ITEMS: readonly MenuItem[] = [
  { label: POST_MENU_ARTICLE_LABEL, href: POST_MENU_ARTICLE_HREF },
  { label: POST_MENU_SCRIBBLE_LABEL, href: POST_MENU_SCRIBBLE_HREF },
];

const ACCOUNT_MENU_ITEMS: readonly MenuItem[] = [
  { label: ACCOUNT_MENU_LIBRARY_LABEL, href: ACCOUNT_MENU_LIBRARY_HREF },
  { label: ACCOUNT_MENU_ADMIN_LABEL, href: ACCOUNT_MENU_ADMIN_HREF },
];

function MenuItemLink({
  item,
  pathname,
  onClick,
}: {
  item: MenuItem;
  pathname: string;
  onClick: () => void;
}) {
  const isCurrent = pathname === item.href;
  return (
    <Link
      href={item.href}
      aria-current={isCurrent ? 'page' : undefined}
      onClick={onClick}
      className={`${item.icon ? 'flex items-center gap-2' : 'block'} rounded-chip px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        isCurrent ? 'font-semibold' : ''
      }`}>
      {item.icon}
      {item.icon ? <span>{item.label}</span> : item.label}
    </Link>
  );
}

type MenuKind = 'articles' | 'post' | 'account';

type HeaderDropdownProps = {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  trigger: (props: {
    ref: RefObject<HTMLButtonElement | null>;
    isOpen: boolean;
    panelId: string;
    onClick: () => void;
  }) => ReactNode;
  align?: 'left' | 'right';
  panelClassName?: string;
  children: (props: { close: () => void }) => ReactNode;
};

// Shared dropdown container for header menus (docs/site-header-requirements.md §4).
// Opens on click, closes on outside click or Escape, and restores focus on Escape.
function HeaderDropdown({
  isOpen,
  onToggle,
  onClose,
  trigger,
  align = 'left',
  panelClassName = '',
  children,
}: HeaderDropdownProps) {
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useDismiss<HTMLDivElement>(isOpen, (reason) => {
    onClose();
    if (reason === 'escape') {
      triggerRef.current?.focus();
    }
  });

  return (
    <div ref={containerRef} className='relative'>
      {trigger({
        ref: triggerRef,
        isOpen,
        panelId,
        onClick: onToggle,
      })}
      {isOpen && (
        <div
          id={panelId}
          className={`popup-panel absolute top-full z-20 mt-1 rounded-panel border border-zinc-200 bg-surface p-1 shadow-lg dark:border-zinc-800 ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${panelClassName}`}>
          {children({ close: onClose })}
        </div>
      )}
    </div>
  );
}

export function SiteHeaderNav({
  username,
  siteName,
}: {
  username: string | null;
  siteName: string;
}) {
  const pathname = usePathname();
  const section = getSiteSection(pathname);
  const [openMenu, setOpenMenu] = useState<MenuKind | null>(null);

  const toggleMenu = (menu: MenuKind) => {
    setOpenMenu((current) => (current === menu ? null : menu));
  };
  const closeMenu = () => setOpenMenu(null);

  const isArticlesSection = section === 'articles';
  const isScribblesSection = section === 'scribbles';

  return (
    <>
      <div className='flex min-w-0 items-center gap-4 sm:gap-6'>
        {/* The name is the link's label rather than its text, so it is read whole even where the
            text is cut: an admin may set up to 40 characters (docs/site-settings-requirements.md
            §3), and the name gives way before the menu does. Signed in, a 360px row also holds
            投稿する and the account button, and the name does not fit beside them at all
            (docs/site-header-requirements.md §3.4); the mark stands for it there. */}
        <Link
          href='/'
          aria-label={siteName}
          className='flex min-w-0 items-center gap-2 text-lg font-bold tracking-tight whitespace-nowrap'>
          <SiteMark className='h-6 w-6 shrink-0' />
          <span className={username ? 'hidden truncate sm:block' : 'truncate'}>{siteName}</span>
        </Link>
        <nav aria-label='サイト' className='flex shrink-0 items-center gap-4 sm:gap-6'>
          <HeaderDropdown
            isOpen={openMenu === 'articles'}
            onToggle={() => toggleMenu('articles')}
            onClose={closeMenu}
            panelClassName='min-w-36'
            trigger={({ ref, isOpen, panelId, onClick }) => (
              <button
                ref={ref}
                type='button'
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={onClick}
                className={`flex items-center gap-1 text-sm font-semibold whitespace-nowrap ${
                  isArticlesSection
                    ? 'text-zinc-900 dark:text-zinc-50'
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50'
                }`}>
                {NAV_ARTICLES_LABEL}
                <svg aria-hidden='true' viewBox='0 0 16 16' className='h-3.5 w-3.5'>
                  <path d='M4 6l4 4 4-4' fill='none' stroke='currentColor' strokeWidth='1.8' />
                </svg>
              </button>
            )}>
            {({ close }) => (
              <div className='min-w-36'>
                <ul>
                  {ARTICLES_MENU_ITEMS.map((item) => (
                    <li key={item.href}>
                      <MenuItemLink item={item} pathname={pathname} onClick={close} />
                    </li>
                  ))}
                </ul>
                <div className='my-1 border-t border-zinc-200 dark:border-zinc-800' />
                <MenuItemLink
                  item={ARTICLES_SEARCH_MENU_ITEM}
                  pathname={pathname}
                  onClick={close}
                />
              </div>
            )}
          </HeaderDropdown>

          <Link
            href={NAV_SCRIBBLES_HREF}
            aria-current={pathname === NAV_SCRIBBLES_HREF ? 'page' : undefined}
            className={`text-sm font-semibold whitespace-nowrap ${
              isScribblesSection
                ? 'text-zinc-900 dark:text-zinc-50'
                : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50'
            }`}>
            {NAV_SCRIBBLES_LABEL}
          </Link>
        </nav>
      </div>

      {username && (
        <nav aria-label='アカウント' className='flex shrink-0 items-center gap-2 sm:gap-3'>
          <HeaderDropdown
            isOpen={openMenu === 'post'}
            onToggle={() => toggleMenu('post')}
            onClose={closeMenu}
            align='right'
            panelClassName='min-w-36'
            trigger={({ ref, isOpen, panelId, onClick }) => (
              <button
                ref={ref}
                type='button'
                aria-label={POST_BUTTON_LABEL}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={onClick}
                className='button-primary flex h-10 w-10 sm:h-9 sm:w-auto items-center justify-center gap-1.5 sm:px-3 sm:py-2 text-sm font-medium'>
                <svg aria-hidden='true' viewBox='0 0 16 16' className='h-4 w-4 shrink-0'>
                  <path
                    d='M8 3v10M3 8h10'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                    strokeLinecap='round'
                  />
                </svg>
                <span className='hidden sm:inline'>{POST_BUTTON_LABEL}</span>
              </button>
            )}>
            {({ close }) => (
              <ul className='min-w-36'>
                {POST_MENU_ITEMS.map((item) => (
                  <li key={item.href}>
                    <MenuItemLink item={item} pathname={pathname} onClick={close} />
                  </li>
                ))}
              </ul>
            )}
          </HeaderDropdown>

          <HeaderDropdown
            isOpen={openMenu === 'account'}
            onToggle={() => toggleMenu('account')}
            onClose={closeMenu}
            align='right'
            panelClassName='min-w-44'
            trigger={({ ref, isOpen, panelId, onClick }) => (
              <button
                ref={ref}
                type='button'
                aria-label={ACCOUNT_MENU_BUTTON_LABEL}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={onClick}
                className='flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold bg-(--chip-bg) text-(--chip-fg)'>
                {getInitialLetter(username)}
              </button>
            )}>
            {({ close }) => (
              <div className='min-w-44'>
                <div className='px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400 break-all'>
                  {username} {ACCOUNT_MENU_LOGGED_IN_SUFFIX}
                </div>
                <ul>
                  {ACCOUNT_MENU_ITEMS.map((item) => (
                    <li key={item.href}>
                      <MenuItemLink item={item} pathname={pathname} onClick={close} />
                    </li>
                  ))}
                </ul>
                <div className='my-1 border-t border-zinc-200 dark:border-zinc-800' />
                <form action={logout}>
                  <button
                    type='submit'
                    className='block w-full rounded-chip px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800'>
                    {ACCOUNT_MENU_LOGOUT_LABEL}
                  </button>
                </form>
              </div>
            )}
          </HeaderDropdown>
        </nav>
      )}
    </>
  );
}
