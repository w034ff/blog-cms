export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800 mt-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
        &copy; {new Date().getFullYear()} Tech Blog. Built with Next.js + MDX.
      </div>
    </footer>
  );
}
