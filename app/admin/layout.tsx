import { verifySession } from '@/lib/dal';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The second of two independent refusals, not the only one. `proxy.ts` (Next 16's middleware
  // file, matcher `/admin/:path*`) already redirects an unauthenticated request to /login, so
  // removing this call changes no response while that stands — measured 2026-09-12, by removing
  // each in turn: the suite stays green until BOTH are gone. It stays because one edge check is
  // not where authorization should end, and being the sole layout between these routes and the
  // root is what lets it cover routes not written yet. `cache`d in lib/dal.ts, so a page that
  // needs the session again pays nothing.
  //
  // It deliberately renders no shell. The two surfaces below it want different ones and a nested
  // layout cannot take a parent's chrome back off: 記事一覧 keeps SiteHeader (app/admin/(list)),
  // the editor screens carry only their own way back (app/admin/posts). Each therefore brings its
  // own PageMain/SiteColumn (components/PageShell.tsx), which is two call sites rather than two
  // copies of the geometry. Splitting /admin across two top-level groups would have
  // made the shells implicit again at the cost of writing this file twice, and a forgotten shell
  // is a full-bleed page you see at once.
  await verifySession();

  return <>{children}</>;
}
