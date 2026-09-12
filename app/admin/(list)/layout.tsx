import { SiteHeader } from '@/components/SiteHeader';
import { PageMain, SiteColumn } from '@/components/PageShell';

// 記事一覧 wears the site's header: it is a navigation screen, and the header is how an author
// reaches the public site, Tags and Categories from here. The editor screens do not
// (app/admin/posts/layout.tsx) — that is the whole reason this route group exists. `(list)` is
// not part of the URL, so the page inside is still /admin.
//
// No SiteFooter, and not an oversight. Its line is a copyright notice addressed to readers, and
// this screen sits behind a login where the one person who sees it already owns the site. The
// header earns its place here by doing navigation; the footer does no work on this page. Nothing
// depends on it structurally either — `mt-auto` only pins the footer itself, and the <main> below
// carries the `flex-1` that fills the body's column.
export default function AdminListLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <PageMain>
        <SiteColumn>{children}</SiteColumn>
      </PageMain>
    </>
  );
}
