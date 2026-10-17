import { SiteHeader } from '@/components/SiteHeader';
import { PageMain, SiteColumn } from '@/components/PageShell';
import { isAdmin } from '@/lib/dal';
import { AdminSideNav } from './AdminSideNav';

// 記事一覧 and タグの管理 wear the site's header, its way to the public site, タグ and カテゴリ,
// and share the management menu beside them; the editor screens do not (app/admin/posts/layout.tsx),
// which is why this route group exists. `(list)` is not in the URL. No SiteFooter: a copyright line
// for readers does no work behind a login, and the <main> below, not the footer, carries the
// `flex-1`.
export default async function AdminListLayout({ children }: { children: React.ReactNode }) {
  const admin = await isAdmin();
  return (
    <>
      <SiteHeader />
      <PageMain>
        <SiteColumn>
          <div className='md:flex md:items-start md:gap-10'>
            <AdminSideNav showTags={admin} />
            <div className='min-w-0 flex-1'>{children}</div>
          </div>
        </SiteColumn>
      </PageMain>
    </>
  );
}
