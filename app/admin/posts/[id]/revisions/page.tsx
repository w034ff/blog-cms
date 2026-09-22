import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteColumn } from '@/components/PageShell';
import { formatRevisionTime } from '@/lib/format';
import type { DraftContent } from '@/lib/types';
import { getPostForEdit, liveContent } from '@/lib/posts';
import { listRevisions, type RevisionReason } from '@/lib/revisions';
import { ChevronRightIcon } from '@/components/editor/svg/ChevronRightIcon';

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

// One row: the live post or a revision. The padding is the row's, not the box's, so the dividers
// and the hover background both run to the box's edges; `overflow-hidden` on the box keeps that
// background inside its rounded corners. Both open a preview, so both end in › — the only sign a
// row goes anywhere on a touch screen, where there is no hover.
function Row({
  href,
  heading,
  badge,
  title,
}: {
  href: string;
  heading: string;
  badge: { label: string; className: string } | null;
  // Shown only where it differs from the title in the editor now: titles rarely change between
  // versions, and on every row it would identify none of them.
  title: string | null;
}) {
  return (
    <Link
      href={href}
      className='flex min-w-0 items-center gap-2 px-3 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900'>
      <span className='shrink-0 font-medium'>{heading}</span>
      {badge && <span className={`${BADGE} ${badge.className}`}>{badge.label}</span>}
      {title !== null && (
        <span className='truncate text-xs text-zinc-500 dark:text-zinc-400'>
          {title.trim() || '（無題）'}
        </span>
      )}
      <span className='ml-auto shrink-0 pl-2 text-zinc-400'>
        <ChevronRightIcon />
      </span>
    </Link>
  );
}

// The page a revision is chosen from (§5). Nothing here writes: each row opens the revision's
// preview, which is where 「復元する」 is, so a version is always read before it is restored.
export default async function RevisionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const postId = Number(id);
  const post = Number.isInteger(postId) ? await getPostForEdit(postId) : null;
  if (!post || post.slug === null) notFound();
  const previewHref = (rev: number | 'live') => `/posts/${post.slug}?rev=${rev}`;
  // What the editor opens with: the working copy when there is one.
  const current = post.draftContent ?? liveContent(post);
  const revisions = listRevisions(post.id);
  const differingTitle = (content: DraftContent) =>
    content.title !== current.title ? content.title : null;

  return (
    <SiteColumn>
      <div className='flex items-center justify-between gap-4'>
        <h1 className='min-w-0 truncate text-2xl font-bold tracking-tight'>リビジョン履歴</h1>
        <Link href={`/admin/posts/${post.id}/edit`} className='shrink-0 text-sm hover:underline'>
          編集に戻る
        </Link>
      </div>
      {/* Which post, since nothing else on the page says it once titles stop differing. */}
      <p className='mt-1 truncate text-sm text-zinc-600 dark:text-zinc-400'>
        {current.title.trim() || '（無題）'}
      </p>

      {/* The live version is the post's own row, not a revision (§4) — the present, not a point
          in the past, so it stands apart from the list. It is also how pending edits are
          discarded. A draft has none. */}
      {!post.draft && (
        <section className='mt-6' aria-label='公開中の記事'>
          <div className='overflow-hidden rounded border border-zinc-200 dark:border-zinc-800'>
            <Row
              href={previewHref('live')}
              heading='公開中の記事'
              // The same badge 記事一覧 gives the same state (app/admin/(list)/page.tsx).
              badge={
                post.hasPendingEdits
                  ? {
                      label: '未公開の変更',
                      className: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
                    }
                  : null
              }
              title={differingTitle(liveContent(post))}
            />
          </div>
        </section>
      )}

      <section className='mt-6'>
        <h2 className='text-sm font-bold'>過去のリビジョン</h2>
        {revisions.length === 0 ? (
          <p className='mt-2 text-sm text-zinc-500 dark:text-zinc-400'>
            リビジョンはまだありません。
          </p>
        ) : (
          <ul
            className='mt-2 divide-y divide-zinc-200 overflow-hidden rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800'
            aria-label='リビジョンの一覧'>
            {revisions.map((revision) => (
              <li key={revision.id}>
                <Row
                  href={previewHref(revision.id)}
                  heading={formatRevisionTime(revision.createdAt)}
                  badge={REASONS[revision.reason]}
                  title={differingTitle(revision.content)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </SiteColumn>
  );
}
