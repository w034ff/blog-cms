import { verifySession } from '@/lib/dal';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The second of two independent refusals: `proxy.ts` (matcher `/admin/:path*`) already redirects
  // to /login, and removing either alone changes no response. It stays because an edge check is not
  // where authorization should end, and as the one layout over /admin it covers routes not yet
  // written. `cache`d in lib/dal.ts.
  //
  // No shell: 記事一覧 keeps SiteHeader (app/admin/(list)) and the editor screens do not
  // (app/admin/posts), and a nested layout cannot take a parent's chrome back off. Each brings its
  // own PageMain/SiteColumn (components/PageShell.tsx).
  await verifySession();

  return <>{children}</>;
}
