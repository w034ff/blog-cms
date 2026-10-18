import type { Metadata } from 'next';
import { isAdmin, verifySession } from '@/lib/dal';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { DISPLAY_NAME_MAX_CHARS } from '@/lib/display-name';
import { ScreenHeading } from '../ScreenHeading';
import { AccountForm } from './AccountForm';

const ACCOUNT_TITLE = 'アカウントの設定';

export const metadata: Metadata = { title: ACCOUNT_TITLE };

export const dynamic = 'force-dynamic';

// The user's account settings (docs/multi-author-requirements.md §6.1). Accessible to any signed-in user.
export default async function AdminAccountPage() {
  const session = await verifySession();
  const admin = await isAdmin();
  const user = db
    .select({ displayName: users.displayName, googleSub: users.googleSub })
    .from(users)
    .where(eq(users.id, session.userId))
    .get();

  return (
    <section>
      <div className='mb-6'>
        <ScreenHeading title={ACCOUNT_TITLE} admin={admin} />
      </div>
      <AccountForm
        initialDisplayName={user?.displayName ?? ''}
        max={DISPLAY_NAME_MAX_CHARS}
        // Only a password account may clear its name (docs/multi-author-requirements.md §10.4).
        canBeEmpty={user?.googleSub === null}
      />
    </section>
  );
}
