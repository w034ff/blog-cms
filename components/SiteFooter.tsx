export function SiteFooter() {
  return (
    // px-4 on the outer element, matching SiteHeader — see the note there.
    <footer className='border-t border-zinc-200 dark:border-zinc-800 mt-auto px-4'>
      <div className='mx-auto max-w-site py-6 text-sm text-zinc-500 dark:text-zinc-400'>
        &copy; {new Date().getFullYear()} Tech Blog. Built with Next.js + MDX.
      </div>
    </footer>
  );
}
