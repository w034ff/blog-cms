import type { Metadata } from 'next';
import { verifyAdmin } from '@/lib/dal';
import { getSiteIdentity } from '@/lib/site-settings';
import { getAllPosts } from '@/lib/posts';
import { readPinnedPostId } from '@/lib/pinned-post';
import { splitPinned } from '@/lib/post-list';
import { ScreenHeading } from '../ScreenHeading';
import { SettingsForm } from './SettingsForm';
import { PickupPanel } from './PickupPanel';

const SETTINGS_TITLE = 'サイトの設定';

export const metadata: Metadata = { title: SETTINGS_TITLE };

export const dynamic = 'force-dynamic';

// The site's name and description (docs/site-settings-requirements.md §5), and the pinned post
// (§10). An author gets a 404, as from the tag dictionary.
export default async function AdminSettingsPage() {
  await verifyAdmin();
  const site = await getSiteIdentity();
  const { pinned } = splitPinned(await getAllPosts(), readPinnedPostId());

  return (
    <section>
      <div className='mb-6'>
        <ScreenHeading title={SETTINGS_TITLE} admin />
      </div>
      <SettingsForm initial={site} />
      <PickupPanel post={pinned} />
    </section>
  );
}
