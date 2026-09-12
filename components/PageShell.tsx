import type { ReactNode } from 'react';

// The page's main box, and the column inside it. They live here, in one place, because the values
// are an invariant across surfaces rather than a choice each layout makes — and because there are
// now three layouts that would otherwise hand-copy them (app/(site), app/admin/(list),
// app/admin/posts). Copied strings of padding do not break when they drift, they just stop lining
// up, which is the kind of defect nobody reports.
//
// `px-4` belongs to PageMain — the full-bleed element — and not to the column inside it, for the
// reason SiteHeader.tsx spells out: the header pads the same way, so a column padded instead of
// wrapped would come out 16px narrower on each side than every page and show up as the site title
// sitting right of the body text.
//
// `flex-1` answers to the body's flex column (app/layout.tsx), which is what lets SiteFooter's
// `mt-auto` sit at the bottom of a short page.
export function PageMain({ children }: { children: ReactNode }) {
  return <main className='w-full flex-1 px-4 py-8'>{children}</main>;
}

// The reading column. Separate from PageMain rather than folded into it with a flag, because the
// public post page deliberately goes wider than this for its table-of-contents rail — the site
// shell therefore uses PageMain alone and lets each page set its own root width.
export function SiteColumn({ children }: { children: ReactNode }) {
  return <div className='mx-auto w-full max-w-site'>{children}</div>;
}
