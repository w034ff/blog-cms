import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { PageMain } from '@/components/PageShell';

// The reader-facing shell, in a route group because a nested layout cannot take a parent's chrome
// back off and the editor screens must not carry it. The root layout keeps <html>/<body>, so this
// is not a second root layout and navigation between shells stays client-side; `flex-1` and
// SiteFooter's `mt-auto` answer to the body's flex column.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      {/* No SiteColumn: each page's root sets its own max-width, since the post page goes wider
          for its table-of-contents rail. */}
      <PageMain>{children}</PageMain>
      <SiteFooter />
    </>
  );
}
