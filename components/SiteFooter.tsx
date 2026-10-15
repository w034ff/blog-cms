import { SITE_NAME } from '@/app/shared-metadata';

export function SiteFooter() {
  return (
    // px-4 on the outer element, matching SiteHeader — see the note there.
    <footer className='border-t border-zinc-200 dark:border-zinc-800 mt-auto px-4'>
      <div className='mx-auto max-w-page py-6 text-sm text-zinc-600 dark:text-zinc-400'>
        &copy; {new Date().getFullYear()} {SITE_NAME}. Built with Next.js + MDX.
      </div>
    </footer>
  );
}
