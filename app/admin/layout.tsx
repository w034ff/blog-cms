import { verifySession } from '@/lib/dal';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // There is no middleware: this call is the admin routes' auth gate. `cache`d in
  // lib/dal.ts, so a page that needs the session again pays nothing.
  await verifySession();

  // No nav of its own. 管理 and サイトを見る duplicated SiteHeader's links, and on the
  // editor screens the row was a third band of chrome above a screen whose point is the
  // post — 新規記事 and ログアウト moved onto the 記事一覧 page, the only screen that
  // needs them. What stays here is the column width: app/layout.tsx's <main> sets none
  // ("moved into each page's own root element") and the admin pages render a bare
  // <section>, so without this wrapper the editor goes full-bleed.
  return <div className='mx-auto w-full max-w-site'>{children}</div>;
}
