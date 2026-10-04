'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { useDismiss } from '@/components/editor/useDismiss';

export type MenuOption = { label: string; href: string; current: boolean };

// A dropdown of links for one of 記事一覧's list parameters (category, sort). Links rather than a
// <select>: each choice is a URL (lib/admin-post-list.ts listHref), so it works as navigation,
// keeps the back button, and needs no submit. The trigger shows the current choice.
export function OptionMenu({ label, options }: { label: string; options: MenuOption[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const current = options.find((option) => option.current);

  return (
    <div ref={ref} className='relative'>
      <button
        type='button'
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className='flex items-center gap-1 py-1 text-sm whitespace-nowrap text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50'>
        <span className='sr-only'>{label}: </span>
        {current?.label ?? label}
        <svg aria-hidden='true' viewBox='0 0 16 16' className='h-3 w-3'>
          <path d='M4 6l4 4 4-4' fill='none' stroke='currentColor' strokeWidth='1.6' />
        </svg>
      </button>
      {open && (
        <ul
          id={panelId}
          className='absolute top-full right-0 z-20 mt-1 min-w-full rounded-panel border border-zinc-200 bg-surface p-1 shadow-lg dark:border-zinc-800'>
          {options.map((option) => (
            <li key={option.href}>
              <Link
                href={option.href}
                aria-current={option.current ? 'true' : undefined}
                onClick={() => setOpen(false)}
                className={`block rounded-chip px-3 py-1.5 text-sm whitespace-nowrap hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                  option.current ? 'font-semibold' : ''
                }`}>
                {option.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
