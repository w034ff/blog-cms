import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { PageMain } from '@/components/PageShell';

// The reader-facing shell. It sits in a route group rather than in the root layout because a
// nested layout cannot take a parent's chrome back off, and the editor screens must not carry it:
// note and Zenn both replace the site's header with the document's own on the writing screen
// (measured 2026-09-11), and /admin has its own chrome in app/admin/layout.tsx.
//
// The root layout keeps <html>/<body>, so this is NOT a second root layout — navigation between
// the two shells stays client-side. `flex-1` and SiteFooter's `mt-auto` still answer to the body's
// flex column, which is a parent of this one.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      {/* PageMain without SiteColumn: no max-width here, because it lives on each page's own root
          element — the post page goes wider than the rest of the site for its table-of-contents
          rail, and a shared constraint would clip that per-page choice. */}
      <PageMain>{children}</PageMain>
      <SiteFooter />
    </>
  );
}
