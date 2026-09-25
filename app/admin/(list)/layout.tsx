import { SiteHeader } from '@/components/SiteHeader';
import { PageMain, SiteColumn } from '@/components/PageShell';

// 記事一覧 wears the site's header, its way to the public site, Tags and Categories; the editor
// screens do not (app/admin/posts/layout.tsx), which is why this route group exists. `(list)` is
// not in the URL. No SiteFooter: a copyright line for readers does no work behind a login, and
// the <main> below, not the footer, carries the `flex-1`.
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
