import type { Metadata } from 'next';
import { verifyAdmin } from '@/lib/dal';
import { listInvites, readAuthorAccessMode } from '@/lib/author-access';
import { listAdminUsers } from '@/lib/admin-users';
import { ScreenHeading } from '../ScreenHeading';
import { ParticipationForm } from './ParticipationForm';
import { InviteForm } from './InviteForm';
import { UsersList } from './UsersList';
import { USERS_TITLE } from './constants';

export const metadata: Metadata = { title: USERS_TITLE };

export const dynamic = 'force-dynamic';

// Users management screen (/admin/users, docs/multi-author-requirements.md §9.5).
// Accessible only to admins; authors get a 404.
export default async function AdminUsersPage() {
  await verifyAdmin();
  const accessMode = readAuthorAccessMode();
  const invites = listInvites();
  const usersList = listAdminUsers();

  return (
    <section>
      <div className='mb-6'>
        <ScreenHeading title={USERS_TITLE} admin />
      </div>
      <div className='flex flex-col gap-6'>
        <ParticipationForm initialMode={accessMode} />
        <InviteForm />
        <UsersList invites={invites} users={usersList} />
      </div>
    </section>
  );
}
