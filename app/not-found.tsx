import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { PageMain } from '@/components/PageShell';
import { NotFoundContent, notFoundMetadata } from '@/components/NotFoundContent';

export const metadata = notFoundMetadata;

// Reached with the root layout alone (a URL no route matches, or a segment outside every shell),
// so it brings the reader's shell itself: a reader who followed a dead link needs a way back.
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <PageMain>
        <NotFoundContent />
      </PageMain>
      <SiteFooter />
    </>
  );
}
