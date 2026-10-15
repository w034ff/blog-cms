import Link from 'next/link';

export function SiteHeader() {
  return (
    // px-4 on the outer element, as PageMain (PageShell.tsx) pads, so pages' `mx-auto max-w-page`
    // roots get the full column; padding the inner box would put the title 16px right of the body
    // text.
    <header className='border-b border-zinc-200 dark:border-zinc-800 px-4'>
      <div className='mx-auto max-w-page py-4 flex items-center justify-between'>
        <Link href='/' className='text-lg font-bold tracking-tight whitespace-nowrap'>
          Tech Blog
        </Link>
        <nav className='flex gap-4 text-sm'>
          <Link href='/tags' className='whitespace-nowrap hover:underline'>
            タグ
          </Link>
          <Link href='/categories' className='whitespace-nowrap hover:underline'>
            カテゴリ
          </Link>
          <Link href='/scribbles' className='whitespace-nowrap hover:underline'>
            走り書き
          </Link>
          <Link href='/admin' className='whitespace-nowrap hover:underline'>
            管理
          </Link>
        </nav>
      </div>
    </header>
  );
}
