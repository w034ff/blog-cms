import type { Metadata } from 'next';
import { verifyAdmin } from '@/lib/dal';
import { getSiteIdentity } from '@/lib/site-settings';
import { ScreenHeading } from '../ScreenHeading';
import { SettingsForm } from './SettingsForm';

const SETTINGS_TITLE = 'サイトの設定';

export const metadata: Metadata = { title: SETTINGS_TITLE };

export const dynamic = 'force-dynamic';

// The site's name and description (docs/site-settings-requirements.md §5). An author gets a 404,
// as from the tag dictionary.
export default async function AdminSettingsPage() {
  await verifyAdmin();
  const site = await getSiteIdentity();

  return (
    <section>
      <div className='mb-6'>
        <ScreenHeading title={SETTINGS_TITLE} showTags />
      </div>
      <SettingsForm initial={site} />
    </section>
  );
}
