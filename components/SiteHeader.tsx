import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-3xl px-4 py-4 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Tech Blog
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/" className="hover:underline">
            Home
          </Link>
          <Link href="/tags" className="hover:underline">
            Tags
          </Link>
          <Link href="/categories" className="hover:underline">
            Categories
          </Link>
          <Link href="/admin" className="hover:underline">
            管理
          </Link>
        </nav>
      </div>
    </header>
  );
}
