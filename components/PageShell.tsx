import type { ReactNode } from 'react';

// The page's main box and its column, shared by three layouts (app/(site), app/admin/(list),
// app/admin/posts): copied padding does not break when it drifts, it just stops lining up.
//
// `px-4` belongs to PageMain, the full-bleed element, as SiteHeader pads; a padded column would be
// 16px narrower on each side. `flex-1` answers to the body's flex column (app/layout.tsx), so
// SiteFooter's `mt-auto` reaches the bottom of a short page.
export function PageMain({ children }: { children: ReactNode }) {
  return <main className='w-full flex-1 px-4 py-8'>{children}</main>;
}

// The reading column, separate because the post page goes wider for its ToC rail; the site shell
// uses PageMain alone and each page sets its own root width.
export function SiteColumn({ children }: { children: ReactNode }) {
  return <div className='mx-auto w-full max-w-site'>{children}</div>;
}
