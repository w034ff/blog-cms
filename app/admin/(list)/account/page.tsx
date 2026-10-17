import type { Metadata } from 'next';
import { isAdmin, verifySession } from '@/lib/dal';
import { DISPLAY_NAME_MAX_CHARS, getUserDisplayName } from '@/lib/display-name';
import { ScreenHeading } from '../ScreenHeading';
import { AccountForm } from './AccountForm';

const ACCOUNT_TITLE = 'アカウントの設定';

export const metadata: Metadata = { title: ACCOUNT_TITLE };

export const dynamic = 'force-dynamic';

// The user's account settings (docs/multi-author-requirements.md §6.1). Accessible to any signed-in user.
export default async function AdminAccountPage() {
  const session = await verifySession();
  const showTags = await isAdmin();
  const displayName = getUserDisplayName(session.userId);

  return (
    <section>
      <div className='mb-6'>
        <ScreenHeading title={ACCOUNT_TITLE} showTags={showTags} />
      </div>
      <AccountForm initialDisplayName={displayName} max={DISPLAY_NAME_MAX_CHARS} />
    </section>
  );
}
