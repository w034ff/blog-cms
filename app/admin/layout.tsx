import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { logout } from "@/app/actions/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await verifySession();

  return (
    <div>
      <div className="mb-8 flex items-center justify-between border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <nav className="flex items-center gap-4">
          <Link href="/admin" className="font-bold tracking-tight">
            管理
          </Link>
          <Link href="/admin/posts/new" className="text-sm hover:underline">
            新規記事
          </Link>
          <Link href="/" className="text-sm hover:underline">
            サイトを見る
          </Link>
        </nav>
        <form action={logout} className="flex items-center gap-3 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">
            {session.username}
          </span>
          <button type="submit" className="hover:underline">
            ログアウト
          </button>
        </form>
      </div>
      {children}
    </div>
  );
}
