import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { restoreRevisionAction } from '@/app/actions/revisions';
import { PostArticle } from '@/components/PostArticle';
import { RevisionDiffView } from '@/components/RevisionDiffView';
import { EditorTooltip } from '@/components/editor/EditorTooltip';
import { HistoryIcon } from '@/components/editor/svg/HistoryIcon';
import { PencilIcon } from '@/components/editor/svg/PencilIcon';
import { PENDING_EDITS_KIND, REVISION_KINDS } from '@/components/revision-kinds';
import { getPostForEdit, liveContent, type PostForEdit } from '@/lib/posts';
import { renderMdxToHtml } from '@/lib/render';
import { resolveCard } from '@/lib/resolve-card';
import { diffRevision } from '@/lib/revision-diff';
import { getRevision } from '@/lib/revisions';
import type { DraftContent, Post } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'リビジョンのプレビュー' };

type Params = { id: string; rev: string };
type SearchParams = { [key: string]: string | string[] | undefined };

// What is being previewed (docs/revision-requirements.md §5): a stored revision, or `live` — the
// version in the post's own columns, which is what restoring discards pending edits back to.
type Version = {
  target: number | 'live';
  content: DraftContent;
  // The button's words: what pressing it does. Restoring the live version is discarding.
  action: string;
  // Only `live` can be a no-op: with no pending edits there is nothing to discard.
  restorable: boolean;
  // The kind's colour, as the history list's badge shows it; empty for a live version with
  // nothing pending, which is no kind of revision.
  accent: string;
};

function versionOf(post: PostForEdit, rev: string): Version | null {
  if (rev === 'live') {
    if (post.draft) return null;
    return {
      target: 'live',
      content: liveContent(post),
      action: '未公開の変更を破棄',
      restorable: post.hasPendingEdits,
      accent: post.hasPendingEdits ? PENDING_EDITS_KIND.accent : '',
    };
  }
  const revisionId = Number(rev);
  const revision = Number.isInteger(revisionId) ? getRevision(post.id, revisionId) : null;
  if (!revision) return null;
  return {
    target: revision.id,
    content: revision.content,
    action: '復元する',
    restorable: true,
    accent: REVISION_KINDS[revision.reason].accent,
  };
}

// The header's icon links, in the editor header's own shape (PostEditor.tsx's 記事一覧 and
// 記事の設定 controls): the same classes give them the same size on a pointer and on touch.
const ICON_LINK =
  'toolbar-button group/tt relative inline-flex items-center rounded px-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800';

// A revision drawn as the post would read (§5), under a header in place of the site's: the
// preview is a step in editing, so it wears the editor's chrome — pinned, so 本文 / 差分 and the
// restore stay in reach however far down the version is read — and not the reader's navigation.
// Under app/admin, so the admin layout's session check covers it.
export default async function RevisionPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { id, rev } = await params;
  const postId = Number(id);
  const post = Number.isInteger(postId) ? await getPostForEdit(postId) : null;
  if (!post) notFound();
  const version = versionOf(post, rev);
  if (!version) notFound();

  const shown: Post = { ...post, ...version.content };
  // What the editor opens with: the working copy when there is one. The 差分 view compares the
  // version against it (§9).
  const current = post.draftContent ?? liveContent(post);
  const showDiff = (await searchParams).view === 'diff';
  const { html, toc } = showDiff
    ? { html: '', toc: [] }
    : await renderMdxToHtml(shown.body, { resolveCard });
  const base = `/admin/posts/${post.id}/revisions/${version.target}`;

  return (
    <>
      <div className='editor-header-bar sticky top-0 z-40 -mx-4 -mt-8 mb-8 border-b border-zinc-300 bg-background px-4 py-2 dark:border-zinc-700'>
        <div className='mx-auto flex max-w-site flex-wrap items-center gap-x-3 gap-y-2'>
          {/* The two ways out, as the editor's header shows its own: icons named by aria-label
              and the editor's tooltip. The first sits where the editor's ← does. */}
          <Link
            href={`/admin/posts/${post.id}/revisions`}
            aria-label='リビジョン履歴'
            className={`${ICON_LINK} editor-back-link -mx-1`}>
            <HistoryIcon />
            <EditorTooltip label='リビジョン履歴' />
          </Link>
          <Link
            href={`/admin/posts/${post.id}/edit`}
            aria-label='編集に戻る'
            className={`${ICON_LINK} editor-settings-link`}>
            <PencilIcon />
            <EditorTooltip label='編集に戻る' />
          </Link>
          {/* The kind rides a short bar in its list colour, no words: the author picked this
              version from a list that named it. */}
          <span className='flex items-center gap-2 text-sm font-semibold'>
            {version.accent && (
              <span aria-hidden='true' className={`h-4 border-l-4 ${version.accent}`} />
            )}
            プレビュー
          </span>
          {/* 本文 / 差分: the same version read two ways. Links, since each is its own URL. */}
          <nav
            aria-label='表示'
            className='flex overflow-hidden rounded border border-zinc-300 text-sm dark:border-zinc-700'>
            {(['body', 'diff'] as const).map((view) => {
              const active = (view === 'diff') === showDiff;
              return (
                <Link
                  key={view}
                  href={view === 'diff' ? `${base}?view=diff` : base}
                  aria-current={active ? 'page' : undefined}
                  className={`px-2 py-0.5 ${active ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
                  {view === 'diff' ? '差分' : '本文'}
                </Link>
              );
            })}
          </nav>
          {/* Restores without asking: what it replaces is kept as a revision first, so the
              restore can itself be undone from the same list (§2). The editor's 投稿 shape. */}
          {version.restorable && (
            <form action={restoreRevisionAction} className='ml-auto'>
              <input type='hidden' name='postId' value={post.id} />
              <input type='hidden' name='revision' value={version.target} />
              <button
                type='submit'
                className='editor-publish-button rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300'>
                {version.action}
              </button>
            </form>
          )}
        </div>
      </div>
      <PostArticle
        post={shown}
        html={html}
        toc={toc}
        showDates={false}
        body={
          showDiff ? (
            <div id='revision-diff'>
              <RevisionDiffView diff={diffRevision(version.content, current)} />
            </div>
          ) : undefined
        }
      />
    </>
  );
}
