import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteColumn } from '@/components/PageShell';
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

const BADGE_CLASS = 'shrink-0 rounded px-1.5 py-0.5 text-xs';

// One row: the live post or a revision. The padding is the row's, not the box's, so the dividers
// and the hover background both run to the box's edges; the box rounds its end rows' corners to
// keep that background inside its own. Not `overflow-hidden` on the box: that cut off the
// 編集中と同じ tooltip, which hangs below the row. Both open a preview, so both end in › — the only sign a
// row goes anywhere on a touch screen, where there is no hover.
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
  // Shown only where it differs from the title in the editor now: titles rarely change between
  // versions, and on every row it would identify none of them.
  title: string | null;
  // The content is what the editor holds now: restoring it would change nothing, which the
  // preview says with a disabled button — this says it before the row is opened. An icon, not a
  // badge, so it reads apart from the kind; the words ride along for a screen reader and a pointer.
  current: boolean;
}) {
  return (
    <Link
      href={href}
      className='flex min-w-0 items-center gap-2 px-3 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900'>
      <span className='shrink-0 font-medium'>{heading}</span>
      {badge && <span className={`${BADGE_CLASS} ${badge.badge}`}>{badge.label}</span>}
      {title !== null && (
        <span className='truncate text-xs text-zinc-500 dark:text-zinc-400'>
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

// The page a revision is chosen from (§5). Nothing here writes: each row opens the revision's
// preview, which is where 「復元する」 is, so a version is always read before it is restored.
export default async function RevisionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const postId = Number(id);
  const post = Number.isInteger(postId) ? await getPostForEdit(postId) : null;
  if (!post || post.slug === null) notFound();
  const previewHref = (rev: number | 'live') => `/admin/posts/${post.id}/revisions/${rev}`;
  // What the editor opens with: the working copy when there is one.
  const current = post.draftContent ?? liveContent(post);
  const revisions = listRevisions(post.id);
  // The preview's own test for a disabled 復元する, so the mark and the button cannot disagree —
  // over a CRLF body a publish left behind, say.
  const isCurrent = (content: DraftContent) => diffRevision(current, content).identical;
  const differingTitle = (content: DraftContent) =>
    content.title !== current.title ? content.title : null;

  return (
    <>
      {/* The editor's header, as the preview wears it: the way back is the editor's ←, in its
          place, since this page is opened from the editor and nowhere else. */}
      <RevisionHeaderBar>
        <Link
          href={`/admin/posts/${post.id}/edit`}
          aria-label='編集に戻る'
          className={`${HEADER_ICON_LINK} editor-back-link -mx-1`}>
          <ArrowLeftIcon />
          <EditorTooltip label='編集に戻る' />
        </Link>
      </RevisionHeaderBar>
      <SiteColumn>
        <h1 className='min-w-0 truncate text-2xl font-bold tracking-tight'>リビジョン履歴</h1>
        {/* Which post, since nothing else on the page says it once titles stop differing. */}
        <p className='mt-1 truncate text-sm text-zinc-600 dark:text-zinc-400'>
          {current.title.trim() || '（無題）'}
        </p>

        {/* The live version is the post's own row, not a revision (§4) — the present, not a point
          in the past, so it stands apart from the list. It is also how pending edits are
          discarded. A draft has none. */}
        {!post.draft && (
          <section className='mt-6' aria-label='公開中の記事'>
            <div className='rounded border border-zinc-200 dark:border-zinc-800 [&>a]:rounded'>
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
            <p className='mt-2 text-sm text-zinc-500 dark:text-zinc-400'>
              リビジョンはまだありません。
            </p>
          ) : (
            <ul
              className='mt-2 divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800 [&>li:first-child>a]:rounded-t [&>li:last-child>a]:rounded-b'
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
      </SiteColumn>
    </>
  );
}
