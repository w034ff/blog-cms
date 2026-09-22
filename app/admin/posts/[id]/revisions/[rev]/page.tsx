import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { restoreRevisionAction } from '@/app/actions/revisions';
import { PostArticle } from '@/components/PostArticle';
import { RevisionDiffView } from '@/components/RevisionDiffView';
import { HEADER_ICON_LINK, RevisionHeaderBar } from '@/components/RevisionHeaderBar';
import { EditorTooltip } from '@/components/editor/EditorTooltip';
import { ArrowLeftIcon } from '@/components/editor/svg/ArrowLeftIcon';
import { PencilIcon } from '@/components/editor/svg/PencilIcon';
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
  // The 差分 view's words, in the same act's terms (§9): the sentence over the diff, and what it
  // says instead when pressing would change nothing.
  diffLead: string;
  unchanged: string;
  // Only `live` can be a no-op: with no pending edits there is nothing to discard.
  restorable: boolean;
};

function versionOf(post: PostForEdit, rev: string): Version | null {
  if (rev === 'live') {
    if (post.draft) return null;
    return {
      target: 'live',
      content: liveContent(post),
      // Not 未公開の変更を破棄: at 156px it put the header on two lines up to ~455px wide. What is
      // discarded is said by the 差分 view's sentence; 破棄する alone would read as deleting the post.
      action: '変更を破棄',
      diffLead: '未公開の変更を破棄すると、次のように変わります。',
      unchanged: '破棄しても何も変わりません。',
      restorable: post.hasPendingEdits,
    };
  }
  const revisionId = Number(rev);
  const revision = Number.isInteger(revisionId) ? getRevision(post.id, revisionId) : null;
  if (!revision) return null;
  return {
    target: revision.id,
    content: revision.content,
    action: '復元する',
    diffLead: '復元すると、次のように変わります。',
    unchanged: '復元しても何も変わりません。',
    restorable: true,
  };
}

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
  // What the editor opens with: the working copy when there is one. The 差分 view runs from it to
  // the version — what pressing the button would change (§9).
  const current = post.draftContent ?? liveContent(post);
  // 差分 is the default: the question a preview is opened with is whether to press the button, and
  // the diff answers it where the rendered body does not (§9). 本文 is `?view=body`.
  const showDiff = (await searchParams).view !== 'body';
  // Computed on both views: the button reads it too. Restoring a version the editor already holds
  // would change nothing, so the button stays in place but cannot be pressed.
  const diff = diffRevision(current, version.content);
  const { html, toc } = showDiff
    ? { html: '', toc: [] }
    : await renderMdxToHtml(shown.body, { resolveCard });
  const base = `/admin/posts/${post.id}/revisions/${version.target}`;

  return (
    <>
      <RevisionHeaderBar>
        {/* The two ways out, as the editor's header shows its own: icons named by aria-label
              and the editor's tooltip. The first is the editor's ←, in its place: one step back, to the
              list this version was opened from. */}
        <Link
          href={`/admin/posts/${post.id}/revisions`}
          aria-label='リビジョン履歴'
          className={`${HEADER_ICON_LINK} editor-back-link -mx-1`}>
          <ArrowLeftIcon />
          <EditorTooltip label='リビジョン履歴' />
        </Link>
        <Link
          href={`/admin/posts/${post.id}/edit`}
          aria-label='編集に戻る'
          className={`${HEADER_ICON_LINK} editor-settings-link`}>
          <PencilIcon />
          <EditorTooltip label='編集に戻る' />
        </Link>
        {/* No page name, as neither the editor's header nor the history's has one: the ← and
            差分 / 本文 say what page this is. No kind and no time either — the author picked this
            version from a list that named it. */}
        {/* 本文 / 差分: the same version read two ways. Links, since each is its own URL. */}
        <nav
          aria-label='表示'
          className='flex overflow-hidden rounded border border-zinc-300 text-sm dark:border-zinc-700'>
          {(['diff', 'body'] as const).map((view) => {
            const active = (view === 'diff') === showDiff;
            return (
              <Link
                key={view}
                href={view === 'diff' ? base : `${base}?view=body`}
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
              disabled={diff.identical}
              className='editor-publish-button rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300'>
              {version.action}
            </button>
          </form>
        )}
      </RevisionHeaderBar>
      <PostArticle
        post={shown}
        html={html}
        toc={toc}
        showDates={false}
        body={
          showDiff ? (
            <div id='revision-diff'>
              <RevisionDiffView diff={diff} lead={version.diffLead} unchanged={version.unchanged} />
            </div>
          ) : undefined
        }
      />
    </>
  );
}
