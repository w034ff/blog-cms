'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { logout } from '@/app/actions/auth';
import { useDismiss } from '@/components/editor/useDismiss';
import { getSiteSection, getInitialLetter } from '@/lib/site-section';

// Named constants for UI strings and route paths (docs/site-header-requirements.md §3).
export const NAV_ARTICLES_LABEL = '記事';
export const NAV_SCRIBBLINGS_LABEL = '走り書き';
export const NAV_SCRIBBLINGS_HREF = '/scribbles';

export const ARTICLES_MENU_LATEST_LABEL = '最新の記事';
export const ARTICLES_MENU_LATEST_HREF = '/';
export const ARTICLES_MENU_CATEGORIES_LABEL = 'カテゴリ';
export const ARTICLES_MENU_CATEGORIES_HREF = '/categories';
export const ARTICLES_MENU_TAGS_LABEL = 'タグ';
export const ARTICLES_MENU_TAGS_HREF = '/tags';

export const POST_BUTTON_LABEL = '投稿する';
export const POST_MENU_HEADING = '新しく書く';
export const POST_MENU_ARTICLE_LABEL = '記事';
export const POST_MENU_ARTICLE_HREF = '/admin/posts/new';
export const POST_MENU_SCRIBBLE_LABEL = '走り書き';
export const POST_MENU_SCRIBBLE_HREF = '/admin/posts/new?kind=scribble';

export const ACCOUNT_MENU_BUTTON_LABEL = 'アカウントのメニュー';
export const ACCOUNT_MENU_LOGGED_IN_SUFFIX = 'でログイン中';
export const ACCOUNT_MENU_LIBRARY_LABEL = 'ライブラリ';
export const ACCOUNT_MENU_LIBRARY_HREF = '/admin/library';
export const ACCOUNT_MENU_ADMIN_LABEL = '管理画面';
export const ACCOUNT_MENU_ADMIN_HREF = '/admin';
export const ACCOUNT_MENU_LOGOUT_LABEL = 'ログアウト';

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
  ariaLabel: string;
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
  ariaLabel,
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
          aria-label={ariaLabel}
          className={`absolute top-full z-20 mt-1 rounded-panel border border-zinc-200 bg-surface p-1 shadow-lg dark:border-zinc-800 ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${panelClassName}`}>
          {children({ close: onClose })}
        </div>
      )}
    </div>
  );
}

export function SiteHeaderNav({ username }: { username: string | null }) {
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
      <div className='flex items-center gap-4 sm:gap-6'>
        <Link href='/' className='text-lg font-bold tracking-tight whitespace-nowrap'>
          Tech Blog
        </Link>
        <nav aria-label='サイト' className='flex items-center gap-4 sm:gap-6'>
          <HeaderDropdown
            isOpen={openMenu === 'articles'}
            onToggle={() => toggleMenu('articles')}
            onClose={closeMenu}
            ariaLabel={NAV_ARTICLES_LABEL}
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
              <ul className='min-w-36'>
                <li>
                  <Link
                    href={ARTICLES_MENU_LATEST_HREF}
                    aria-current={pathname === '/' ? 'page' : undefined}
                    onClick={close}
                    className={`block rounded-chip px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                      pathname === '/' ? 'font-semibold' : ''
                    }`}>
                    {ARTICLES_MENU_LATEST_LABEL}
                  </Link>
                </li>
                <li>
                  <Link
                    href={ARTICLES_MENU_CATEGORIES_HREF}
                    aria-current={pathname === '/categories' ? 'page' : undefined}
                    onClick={close}
                    className={`block rounded-chip px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                      pathname === '/categories' ? 'font-semibold' : ''
                    }`}>
                    {ARTICLES_MENU_CATEGORIES_LABEL}
                  </Link>
                </li>
                <li>
                  <Link
                    href={ARTICLES_MENU_TAGS_HREF}
                    aria-current={pathname === '/tags' ? 'page' : undefined}
                    onClick={close}
                    className={`block rounded-chip px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                      pathname === '/tags' ? 'font-semibold' : ''
                    }`}>
                    {ARTICLES_MENU_TAGS_LABEL}
                  </Link>
                </li>
              </ul>
            )}
          </HeaderDropdown>

          <Link
            href={NAV_SCRIBBLINGS_HREF}
            aria-current={pathname === '/scribbles' ? 'page' : undefined}
            className={`text-sm font-semibold whitespace-nowrap ${
              isScribblesSection
                ? 'text-zinc-900 dark:text-zinc-50'
                : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50'
            }`}>
            {NAV_SCRIBBLINGS_LABEL}
          </Link>
        </nav>
      </div>

      {username && (
        <nav aria-label='アカウント' className='flex items-center gap-2 sm:gap-3'>
          <HeaderDropdown
            isOpen={openMenu === 'post'}
            onToggle={() => toggleMenu('post')}
            onClose={closeMenu}
            align='right'
            ariaLabel={POST_BUTTON_LABEL}
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
              <div className='min-w-36'>
                <div className='px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400'>
                  {POST_MENU_HEADING}
                </div>
                <ul>
                  <li>
                    <Link
                      href={POST_MENU_ARTICLE_HREF}
                      onClick={close}
                      className='block rounded-chip px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800'>
                      {POST_MENU_ARTICLE_LABEL}
                    </Link>
                  </li>
                  <li>
                    <Link
                      href={POST_MENU_SCRIBBLE_HREF}
                      onClick={close}
                      className='block rounded-chip px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800'>
                      {POST_MENU_SCRIBBLE_LABEL}
                    </Link>
                  </li>
                </ul>
              </div>
            )}
          </HeaderDropdown>

          <HeaderDropdown
            isOpen={openMenu === 'account'}
            onToggle={() => toggleMenu('account')}
            onClose={closeMenu}
            align='right'
            ariaLabel={ACCOUNT_MENU_BUTTON_LABEL}
            panelClassName='min-w-44'
            trigger={({ ref, isOpen, panelId, onClick }) => (
              <button
                ref={ref}
                type='button'
                aria-label={ACCOUNT_MENU_BUTTON_LABEL}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={onClick}
                className='flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold bg-[var(--chip-bg)] text-[var(--chip-fg)]'>
                {getInitialLetter(username)}
              </button>
            )}>
            {({ close }) => (
              <div className='min-w-44'>
                <div className='px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400 break-all'>
                  {username} {ACCOUNT_MENU_LOGGED_IN_SUFFIX}
                </div>
                <ul>
                  <li>
                    <Link
                      href={ACCOUNT_MENU_LIBRARY_HREF}
                      onClick={close}
                      className='block rounded-chip px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800'>
                      {ACCOUNT_MENU_LIBRARY_LABEL}
                    </Link>
                  </li>
                  <li>
                    <Link
                      href={ACCOUNT_MENU_ADMIN_HREF}
                      onClick={close}
                      className='block rounded-chip px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800'>
                      {ACCOUNT_MENU_ADMIN_LABEL}
                    </Link>
                  </li>
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
