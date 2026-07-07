'use client';

import type { ReactNode } from 'react';

export function ToolbarButton({
  onClick,
  active,
  title,
  destructive,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  // Set for icon-only buttons, where it supplies both the hover tooltip and the
  // accessible name (text buttons don't need it — their label is the text).
  title?: string;
  // Red tint for a destructive action (e.g. delete the whole table), so it reads as
  // "danger" and isn't mistaken for the neutral controls beside it.
  destructive?: boolean;
  children: ReactNode;
}) {
  const tone = destructive
    ? 'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950 dark:hover:text-red-300'
    : 'hover:bg-zinc-100 dark:hover:bg-zinc-800';
  return (
    <button
      type='button'
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`rounded px-2 py-1 text-xs ${tone} ${
        active ? 'bg-zinc-200 dark:bg-zinc-700' : ''
      }`}>
      {children}
    </button>
  );
}
