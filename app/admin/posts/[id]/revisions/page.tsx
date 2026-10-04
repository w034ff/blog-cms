import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EditorColumn } from '@/components/PageShell';
import { HEADER_ICON_LINK, RevisionHeaderBar } from '@/components/RevisionHeaderBar';
import { ArrowLeftIcon } from '@/components/editor/svg/ArrowLeftIcon';
import { formatRevisionTime } from '@/lib/format';
import type { DraftContent } from '@/lib/types';
import { getPostForEdit, liveContent } from '@/lib/posts';
import { listRevisions } from '@/lib/revisions';
import { PENDING_EDITS_KIND, REVISION_KINDS, type RevisionKind } from '@/components/revision-kinds';
import { CheckIcon } from '@/components/editor/svg/CheckIcon';
import { ChevronRightIcon } from '@/components/editor/svg/ChevronRightIcon';
import { EditorTooltip } from '@/components/editor/EditorTooltip';
import { diffRevision } from '@/lib/revision-diff';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'リビジョン履歴' };

const BADGE_CLASS = 'shrink-0 rounded-chip px-1.5 py-0.5 text-xs';

// One row: the live post or a revision. The padding is the row's, so the dividers and hover run
// to the box's edges; the box rounds its end rows instead of `overflow-hidden`, which would clip
// the 編集中と同じ tooltip. Both kinds open a preview, hence the › for touch screens.
function Row({
  href,
  heading,
  badge,
  title,
  current,
}: {
  href: string;
  heading: string;
  badge: RevisionKind | null;
  // Only where it differs from the editor's title now; on every row it would identify none.
  title: string | null;
  // Restoring this would change nothing, as the preview's disabled button says; this says it before
  // the row is opened. An icon, so it reads apart from the kind badge.
  current: boolean;
}) {
  return (
    <Link
      href={href}
      className='flex min-w-0 items-center gap-2 px-3 py-3 hover:bg-zinc-100 dark:hover:bg-zinc-800'>
      <span className='shrink-0 font-medium'>{heading}</span>
      {badge && <span className={`${BADGE_CLASS} ${badge.badge}`}>{badge.label}</span>}
      {title !== null && (
        <span className='truncate text-xs text-zinc-600 dark:text-zinc-400'>
          {title.trim() || '（無題）'}
        </span>
      )}
      <span className='ml-auto flex shrink-0 items-center gap-2 pl-2 text-zinc-400'>
        {current && (
          <span className='group/tt relative text-sky-600 dark:text-sky-400'>
            <CheckIcon />
            <span className='sr-only'>編集中と同じ</span>
            <EditorTooltip label='編集中と同じ' />
          </span>
        )}
        <ChevronRightIcon />
      </span>
    </Link>
  );
}

// The page a revision is chosen from (§5). Nothing here writes: 「復元する」 is on the preview, so a
// version is always read before it is restored.
export default async function RevisionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const postId = Number(id);
  const post = Number.isInteger(postId) ? await getPostForEdit(postId) : null;
  if (!post || post.slug === null) notFound();
  const previewHref = (rev: number | 'live') => `/admin/posts/${post.id}/revisions/${rev}`;
  // What the editor opens with: the working copy when there is one.
  const current = post.draftContent ?? liveContent(post);
  const revisions = listRevisions(post.id);
  // The preview's own test for a disabled 復元する, so the mark and the button cannot disagree.
  const isCurrent = (content: DraftContent) => diffRevision(current, content).identical;
  const differingTitle = (content: DraftContent) =>
    content.title !== current.title ? content.title : null;

  return (
    <div className='revision-page'>
      {/* The editor's header; ← goes back to the editor, the only place this page opens from. */}
      <RevisionHeaderBar>
        <Link
          href={`/admin/posts/${post.id}/edit`}
          aria-label='編集に戻る'
          className={`${HEADER_ICON_LINK} editor-back-link -mx-1`}>
          <ArrowLeftIcon />
          <EditorTooltip label='編集に戻る' />
        </Link>
      </RevisionHeaderBar>
      <EditorColumn>
        <h1 className='min-w-0 truncate text-2xl font-bold tracking-tight'>リビジョン履歴</h1>
        {/* Which post, since nothing else on the page says it once titles stop differing. */}
        <p className='mt-1 truncate text-sm text-zinc-600 dark:text-zinc-400'>
          {current.title.trim() || '（無題）'}
        </p>

        {/* The live version is the post's own row, not a revision (§4), and is how pending edits
            are discarded. A draft has none. */}
        {!post.draft && (
          <section className='mt-6' aria-label='公開中の記事'>
            <div className='rounded-panel border border-zinc-200 bg-surface dark:border-zinc-800 [&>a]:rounded-panel'>
              <Row
                href={previewHref('live')}
                heading='公開中の記事'
                // The same badge 記事一覧 gives the same state (app/admin/(list)/page.tsx).
                badge={post.hasPendingEdits ? PENDING_EDITS_KIND : null}
                title={differingTitle(liveContent(post))}
                current={isCurrent(liveContent(post))}
              />
            </div>
          </section>
        )}

        <section className='mt-6'>
          <h2 className='text-sm font-bold'>過去のリビジョン</h2>
          {revisions.length === 0 ? (
            <p className='mt-2 text-sm text-zinc-600 dark:text-zinc-400'>
              リビジョンはまだありません。
            </p>
          ) : (
            <ul
              className='mt-2 divide-y divide-zinc-200 rounded-panel border border-zinc-200 bg-surface dark:divide-zinc-800 dark:border-zinc-800 [&>li:first-child>a]:rounded-t-panel [&>li:last-child>a]:rounded-b-panel'
              aria-label='リビジョンの一覧'>
              {revisions.map((revision) => (
                <li key={revision.id}>
                  <Row
                    href={previewHref(revision.id)}
                    heading={formatRevisionTime(revision.createdAt)}
                    badge={REVISION_KINDS[revision.reason]}
                    title={differingTitle(revision.content)}
                    current={isCurrent(revision.content)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </EditorColumn>
    </div>
  );
}
