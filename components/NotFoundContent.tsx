import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteMark } from '@/components/SiteMark';

const STATUS_LABEL = '404';
const PAGE_HEADING = 'ページが見つかりません';
// Says nothing about why: a draft read without a session lands here too, and must not be told
// apart from an address that never existed (e2e/draft-preview.spec.ts).
const PAGE_MESSAGE = 'アドレスが間違っているか、ページが移動または削除された可能性があります。';
const HOME_LINK_LABEL = 'ホームへ戻る';
const SEARCH_LINK_LABEL = '記事を検索';

// Reaches the tab only when the failing page's generateMetadata also calls notFound(); one that
// returns `{}` instead leaves the site's bare name there.
export const notFoundMetadata: Metadata = {
  title: PAGE_HEADING,
};

// The 404's body, without a shell. Next renders the nearest not-found.tsx inside every layout
// above the segment that threw, so each shell's own not-found.tsx renders this alone, and only
// app/not-found.tsx — which a URL no route matches reaches with nothing but the root layout —
// adds the header and footer.
export function NotFoundContent() {
  return (
    <section className='mx-auto flex w-full max-w-page flex-col items-center py-12 text-center sm:py-20'>
      <SiteMark className='size-14' />
      <p className='mt-6 font-mono text-7xl font-bold tracking-tight sm:text-8xl'>{STATUS_LABEL}</p>
      <h1 className='mt-4 text-xl font-bold tracking-tight sm:text-2xl'>{PAGE_HEADING}</h1>
      <p className='mt-3 max-w-2xl text-sm text-zinc-600 sm:text-base dark:text-zinc-400'>
        {PAGE_MESSAGE}
      </p>
      <div className='mt-8 flex flex-wrap justify-center gap-3'>
        <Link href='/' className='button-primary px-4 py-2 text-sm font-medium'>
          {HOME_LINK_LABEL}
        </Link>
        <Link href='/search' className='button-secondary px-4 py-2 text-sm font-medium'>
          {SEARCH_LINK_LABEL}
        </Link>
      </div>
    </section>
  );
}
