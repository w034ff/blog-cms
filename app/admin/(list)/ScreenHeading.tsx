'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useState } from 'react';
import { useDismiss } from '@/components/editor/useDismiss';
import { adminNavItems } from './AdminSideNav';

// A management screen's <h1>. From `md` it is the title alone, the rail beside it doing the
// navigating (AdminSideNav); below that the rail is gone and the title is the button that opens its
// items, with a chevron, since nothing else would say it can be pressed. One place says where you
// are and takes you elsewhere, rather than a small menu button repeating the title above it.
export function ScreenHeading({ title, showTags }: { title: string; showTags: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const items = adminNavItems(showTags);

  return (
    <div ref={ref} className='relative'>
      <h1 className='text-2xl font-bold tracking-tight'>
        <span className='hidden md:inline'>{title}</span>
        <button
          type='button'
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
          className='flex items-center gap-1.5 md:hidden'>
          {title}
          <svg aria-hidden='true' viewBox='0 0 16 16' className='h-4 w-4 text-zinc-500'>
            <path d='M4 6l4 4 4-4' fill='none' stroke='currentColor' strokeWidth='1.8' />
          </svg>
        </button>
      </h1>
      {open && (
        <nav
          id={panelId}
          aria-label='管理'
          className='popup-panel absolute top-full left-0 z-20 mt-1 min-w-48 rounded-panel border border-zinc-200 bg-surface p-1 shadow-lg md:hidden dark:border-zinc-800'>
          <ul>
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={item.current(pathname) ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={`block rounded-chip px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                    item.current(pathname) ? 'font-semibold' : ''
                  }`}>
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <span aria-disabled='true' className='block px-3 py-2 text-sm text-zinc-400'>
                統計<span className='ml-2 text-xs'>準備中</span>
              </span>
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}
