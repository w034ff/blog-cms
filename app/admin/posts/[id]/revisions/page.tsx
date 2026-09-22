import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteColumn } from '@/components/PageShell';
import { formatRevisionTime } from '@/lib/format';
import { getPostForEdit } from '@/lib/posts';
import { listRevisions, type RevisionReason } from '@/lib/revisions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '履歴' };

// What each revision was taken ahead of (docs/revision-requirements.md §3), worded as the moment
// the author would remember rather than as the mechanism.
const REASON_LABELS: Record<RevisionReason, string> = {
  publish: '以前の公開版',
  session: '編集を始める前',
  restore: '戻す前',
};

// The list a revision is chosen from (§5). Nothing here writes: each row opens the revision's
// preview, which is where 「この版に戻す」 is, so a version is always read before it is restored.
export default async function RevisionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const postId = Number(id);
  const post = Number.isInteger(postId) ? await getPostForEdit(postId) : null;
  if (!post || post.slug === null) notFound();
  const revisions = listRevisions(post.id);
  const previewHref = (rev: number | 'live') => `/posts/${post.slug}?rev=${rev}`;

  return (
    <SiteColumn>
      <div className='mb-6 flex items-center justify-between gap-4'>
        <h1 className='min-w-0 truncate text-2xl font-bold tracking-tight'>履歴</h1>
        <Link href={`/admin/posts/${post.id}/edit`} className='shrink-0 text-sm hover:underline'>
          編集に戻る
        </Link>
      </div>
      <ul className='divide-y divide-zinc-200 dark:divide-zinc-800' aria-label='版の一覧'>
        {/* The live version is the row, not a revision (§4), so it is listed from the post
            itself. It is also how pending edits are discarded, hence first. */}
        {!post.draft && (
          <li>
            <Link href={previewHref('live')} className='block py-3 hover:underline'>
              <span className='font-medium'>公開中の版</span>
              <span className='block truncate text-xs text-zinc-500 dark:text-zinc-400'>
                {post.title}
                {post.hasPendingEdits && ' · 未公開の変更を破棄するときはこの版に戻す'}
              </span>
            </Link>
          </li>
        )}
        {revisions.map((revision) => (
          <li key={revision.id}>
            <Link href={previewHref(revision.id)} className='block py-3 hover:underline'>
              <span className='font-medium'>{formatRevisionTime(revision.createdAt)}</span>
              <span className='ml-2 text-xs text-zinc-500 dark:text-zinc-400'>
                {REASON_LABELS[revision.reason]}
              </span>
              <span className='block truncate text-xs text-zinc-500 dark:text-zinc-400'>
                {revision.content.title.trim() || '（無題）'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {revisions.length === 0 && (
        <p className='mt-4 text-sm text-zinc-500 dark:text-zinc-400'>
          まだ残っている版はありません。版は、編集を始めたとき・公開中の版を更新したとき・版に戻したときに残ります。
        </p>
      )}
    </SiteColumn>
  );
}
