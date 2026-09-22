import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteColumn } from '@/components/PageShell';
import { formatRevisionTime } from '@/lib/format';
import type { DraftContent } from '@/lib/types';
import { getPostForEdit, liveContent } from '@/lib/posts';
import { listRevisions, type RevisionReason } from '@/lib/revisions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'リビジョン履歴' };

// What each revision was taken ahead of (docs/revision-requirements.md §3), worded as the moment
// the author would remember rather than as the mechanism, and coloured so the two read apart at a
// glance: a version readers saw in green, the safety copy a restore left in grey.
const REASONS: Record<RevisionReason, { label: string; className: string }> = {
  publish: {
    label: '以前の公開記事',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  restore: {
    label: '復元する前',
    className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  },
};

const BADGE = 'shrink-0 rounded px-1.5 py-0.5 text-xs';

// One row of the list: the live post or a revision.
type Entry = {
  key: string;
  kind: 'live' | RevisionReason;
  href: string;
  heading: string;
  badge: { label: string; className: string } | null;
  content: DraftContent;
};

// The list a revision is chosen from (§5). Nothing here writes: each row opens the revision's
// preview, which is where 「復元する」 is, so a version is always read before it is restored.
export default async function RevisionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const postId = Number(id);
  const post = Number.isInteger(postId) ? await getPostForEdit(postId) : null;
  if (!post || post.slug === null) notFound();
  const previewHref = (rev: number | 'live') => `/posts/${post.slug}?rev=${rev}`;
  // What the editor opens with: the working copy when there is one.
  const current = post.draftContent ?? liveContent(post);

  // The live version is the post's own row, not a revision (§4), so it is listed from the post
  // itself — first, since it is also how pending edits are discarded. A draft has none.
  const entries: Entry[] = [
    ...(post.draft
      ? []
      : [
          {
            key: 'live',
            kind: 'live' as const,
            href: previewHref('live'),
            heading: '公開中の記事',
            // The same badge 記事一覧 gives the same state (app/admin/(list)/page.tsx).
            badge: post.hasPendingEdits
              ? {
                  label: '未公開の変更',
                  className: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
                }
              : null,
            content: liveContent(post),
          },
        ]),
    ...listRevisions(post.id).map((revision) => ({
      key: String(revision.id),
      kind: revision.reason,
      href: previewHref(revision.id),
      heading: formatRevisionTime(revision.createdAt),
      badge: REASONS[revision.reason],
      content: revision.content,
    })),
  ];
  const revisionCount = entries.filter((entry) => entry.kind !== 'live').length;

  return (
    <SiteColumn>
      <div className='mb-6 flex items-center justify-between gap-4'>
        <h1 className='min-w-0 truncate text-2xl font-bold tracking-tight'>リビジョン履歴</h1>
        <Link href={`/admin/posts/${post.id}/edit`} className='shrink-0 text-sm hover:underline'>
          編集に戻る
        </Link>
      </div>
      <ul className='divide-y divide-zinc-200 dark:divide-zinc-800' aria-label='リビジョンの一覧'>
        {entries.map((entry) => (
          <li key={entry.key}>
            {/* A background on hover rather than an underline: the row carries badges, and an
                underline running under them reads as a rendering fault. */}
            <Link
              href={entry.href}
              className='-mx-2 flex min-w-0 items-center gap-2 rounded px-2 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900'>
              <span className='shrink-0 font-medium'>{entry.heading}</span>
              {entry.badge && (
                <span className={`${BADGE} ${entry.badge.className}`}>{entry.badge.label}</span>
              )}
              {/* Only where it differs from the title in the editor now: titles rarely change
                  between versions, and on every row it would identify none of them. */}
              {entry.content.title !== current.title && (
                <span className='truncate text-xs text-zinc-500 dark:text-zinc-400'>
                  {entry.content.title.trim() || '（無題）'}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {revisionCount === 0 && (
        <p className='mt-4 text-sm text-zinc-500 dark:text-zinc-400'>
          まだリビジョンはありません。リビジョンは、公開中の記事を更新・非公開にしたときと、復元したときに残ります。
        </p>
      )}
    </SiteColumn>
  );
}
