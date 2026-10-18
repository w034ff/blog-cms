import { accountName } from '@/lib/account-name';
import { getOptionalSession } from '@/lib/dal';
import { getSiteIdentity } from '@/lib/site-settings';
import { SiteHeaderNav } from './SiteHeaderNav';

// The site's top bar (docs/site-header-requirements.md §3).
// Height is fixed to 61px (60px content + 1px border) to align with .editor-header-bar
// (docs/site-header-requirements.md §3.1, e2e/editor-sticky-header.spec.ts).
export async function SiteHeader() {
  const session = await getOptionalSession();
  const site = await getSiteIdentity();

  return (
    // px-4 on the outer element, as PageMain (PageShell.tsx) pads, so pages' `mx-auto max-w-page`
    // roots get the full column; padding the inner box would put the title 16px right of the body text.
    <header className='border-b border-zinc-200 bg-surface px-4 dark:border-zinc-800'>
      <div className='mx-auto flex h-[60px] max-w-page items-center justify-between'>
        <SiteHeaderNav account={session ? accountName(session) : null} siteName={site.name} />
      </div>
    </header>
  );
}
