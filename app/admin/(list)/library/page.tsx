import type { Metadata } from 'next';
import { isAdmin, verifySession } from '@/lib/dal';
import { listLibrary } from '@/lib/library';
import { parseLibraryTab } from '@/lib/admin-post-list';
import { EmptyLibraryList } from '../EmptyPostList';
import { ScreenHeading } from '../ScreenHeading';
import { LibraryTabs } from './LibraryTabs';
import { LibraryRows } from './LibraryRows';

export const metadata: Metadata = { title: 'ライブラリ' };
export const dynamic = 'force-dynamic';

export default async function AdminLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await verifySession();
  const currentTab = parseLibraryTab(await searchParams);

  const bookmarks = listLibrary(session.userId, 'bookmarks');
  const likes = listLibrary(session.userId, 'likes');
  const history = listLibrary(session.userId, 'history');

  const entriesByTab = { bookmarks, likes, history };
  const entries = entriesByTab[currentTab];
  const counts = {
    bookmarks: bookmarks.length,
    likes: likes.length,
    history: history.length,
  };

  return (
    <section>
      <div className='mb-6 flex items-center justify-between gap-4'>
        <ScreenHeading title='ライブラリ' admin={await isAdmin()} />
      </div>
      <LibraryTabs currentTab={currentTab} counts={counts} />
      <div className='rounded-panel border border-zinc-200 bg-surface px-4 dark:border-zinc-800'>
        {entries.length === 0 ? (
          <EmptyLibraryList tab={currentTab} />
        ) : (
          <LibraryRows entries={entries} tab={currentTab} />
        )}
      </div>
    </section>
  );
}
