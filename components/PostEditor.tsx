'use client';

import { useActionState, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import { postEditorExtensions } from './editor/extensions';
import { ThumbnailField } from './editor/ThumbnailField';
import { isPublishableUri } from './editor/link-protocols';
import { Toolbar } from './editor/Toolbar';
import { TableToolbar } from './editor/TableToolbar';
import { LinkBubble } from './editor/LinkBubble';
import { ImageBubble } from './editor/ImageBubble';
import { InsertDialog } from './editor/InsertDialog';
import { INSERT_DIALOG_EVENT, type InsertDialogDetail } from './editor/embed-extension';
import { DropOverlay } from './editor/DropOverlay';
import { EditorToast } from './editor/EditorToast';
import { useAutosave } from './editor/useAutosave';
import { imageFilesFromList, useImageUpload } from './editor/useImageUpload';
import { useEditorNotice } from './editor/useEditorNotice';
import { useDragContainment } from './editor/useDragContainment';
import { bodyContainsImage } from '@/lib/thumbnail';
import type { PostFormState } from '@/app/actions/posts';

export type PostEditorInitial = {
  // Null in create mode; the row id in edit mode.
  id: number | null;
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  body: string;
  thumbnail: string;
  unlisted: boolean;
};

type Props = {
  action: (prev: PostFormState, formData: FormData) => Promise<PostFormState>;
  initial: PostEditorInitial;
  mode: 'create' | 'edit';
  // Current visibility of the live post: true once it has been published.
  published: boolean;
  // Whether the loaded content is a working copy ahead of the published version
  // (a published post with unsaved-to-public edits). Always false in create mode.
  hasPendingEdits: boolean;
};

const emptyState: PostFormState = {};

const inputClass =
  'w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className='block text-sm'>
      <span className='mb-1 block text-zinc-600 dark:text-zinc-400'>{label}</span>
      {children}
    </label>
  );
}

export function PostEditor({ action, initial, mode, published, hasPendingEdits }: Props) {
  const [state, formAction, pending] = useActionState(action, emptyState);
  // Markdown source of the body, kept in sync with the editor and mirrored into a
  // hidden input so autosave and publish read it through the form like before.
  const [body, setBody] = useState(initial.body);
  const [title, setTitle] = useState(initial.title);
  // The author's explicit card image ('' = none chosen). Held in React rather
  // than left uncontrolled like the text fields, because the picker writes it
  // and the preview reads it back.
  const [thumbnail, setThumbnail] = useState(initial.thumbnail);
  // The opaque public slug, only needed to build the 表示 link. Empty in create
  // mode until publish reports the server-assigned slug; otherwise the row's slug.
  const [slug, setSlug] = useState(initial.slug);
  // The session cookie lapsed mid-edit: autosave/publish return 401. We keep the
  // editor mounted (content intact) and prompt a re-login. Cleared by any
  // successful autosave/publish (proof the session is valid again).
  const [sessionExpired, setSessionExpired] = useState(false);
  // Whether the shared insert dialog is up. Held here rather than in the extension because it is
  // React that renders it, and `editor.storage` does not re-render.
  const [insertDialogAt, setInsertDialogAt] = useState<number | null>(null);
  // Stable, so the dialog's Escape listener registers once per open instead of once per render.
  const closeInsertDialog = useCallback(() => setInsertDialogAt(null), []);

  // The post's server identity (row id). Null in create mode until the first
  // autosave (or a publish) materializes the row; from then on edits update it.
  const [committedId, setCommittedId] = useState<number | null>(initial.id);
  // Live visibility, and whether the editor holds edits not yet pushed public.
  const [isPublished, setIsPublished] = useState(published);
  const [pendingPublish, setPendingPublish] = useState(hasPendingEdits);

  // A returned server error (e.g. duplicate slug) shows until the next edit, so
  // it doesn't linger while the user fixes the input.
  const [errorVisible, setErrorVisible] = useState(false);
  const [handledState, setHandledState] = useState(state);
  // The last `body` the thumbnail-staleness check below has already reacted to — see there.
  const [handledBody, setHandledBody] = useState(body);

  const formRef = useRef<HTMLFormElement>(null);
  // Refs mirror state the autosave machinery reads outside React's render flow.
  const committedIdRef = useRef<number | null>(committedId);
  // Edit-mode posts already sit at their final URL; only create-mode posts need
  // a one-time address-bar sync once they gain an identity.
  const urlSyncedRef = useRef(mode === 'edit');
  const publishedRef = useRef(isPublished);
  // A hedge, not a requirement: nothing here can capture a stale markEdited today.
  // @tiptap/react wraps every option callback at editor creation, so the onUpdate
  // below is invoked through `this.options.current.onUpdate` — re-read on each
  // render ("Always call the most recent version of the callback function by
  // default", @tiptap/react's own words) — and markEdited is identity-stable
  // regardless, its useCallback deps all being stable. Kept because the failure it
  // guards against is silent: were markEdited to stop being stable, a stale closure
  // would leave autosave quietly no longer recording edits.
  const markEditedRef = useRef<() => void>(() => {});
  // The live editor instance, handed to the image-upload hook (set from an
  // effect once useEditor delivers it).
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    committedIdRef.current = committedId;
  }, [committedId]);
  useEffect(() => {
    publishedRef.current = isPublished;
  }, [isPublished]);

  const hasIdentity = committedId !== null;

  // Autosave wiring: the hook owns the dirty/debounce/save machinery; the
  // publish-flow state stays here and is updated through these callbacks.
  const handleCreated = useCallback((id: number, createdSlug: string) => {
    setCommittedId(id);
    // The slug the row was created with (§18). Nothing on screen changes — 表示 is gated on
    // `isPublished` — but from here the card picker can tell this post apart from every other.
    if (createdSlug !== '') setSlug(createdSlug);
  }, []);
  // An edit to a live post is a pending publish until pushed public again.
  const handleDirty = useCallback(() => {
    if (publishedRef.current) setPendingPublish(true);
  }, []);
  const { autosaveState, savedAt, unsaved, markEdited, cancelPendingAutosave, acceptSaved } =
    useAutosave({
      formRef,
      committedIdRef,
      onCreated: handleCreated,
      onDirty: handleDirty,
      onSessionExpired: setSessionExpired,
    });

  // One refusal notice for the whole editor, written to by the image guards and by the table cell
  // paste guard. Owned here rather than in either of them so two refusals can't raise two toasts.
  const { notice, showNotice } = useEditorNotice();

  // The thumbnail setter every caller uses (ThumbnailField's picker and 解除, ImageBubble's
  // toggle) — plain `setThumbnail` would change the field without arming autosave, since none of
  // them is a native form event the `<form onInput>` handler below can see. The picker's own
  // `input` event does not carry it either: the file input has no `name`, and what reaches the
  // form is the uploaded path, written a fetch later.
  const applyThumbnail = useCallback(
    (next: string) => {
      setThumbnail(next);
      markEdited();
    },
    [markEdited],
  );

  const { uploading, dragging, uploadImages, handleImageChange } = useImageUpload(
    editorRef,
    showNotice,
  );

  // Keep a drag that started in the editor from landing on the fields beside it (see the hook —
  // the browser's own move deletes the dragged range out of the document).
  useDragContainment(editorRef);

  // Reset visibility whenever a new action result arrives, per React's "adjust
  // state when a value changes" guidance, not in an effect.
  if (state !== handledState) {
    setHandledState(state);
    setErrorVisible(Boolean(state.error));
    // React to a publish/unpublish result during render (the sanctioned
    // "adjust state when a value changes" pattern). The matching URL side-effect
    // lives in an effect below.
    if (state.sessionExpired) {
      setSessionExpired(true);
    } else if (state.saved) {
      setIsPublished(state.saved.published);
      setPendingPublish(false);
      acceptSaved(state.saved.at);
      setSessionExpired(false);
      if (committedId === null) setCommittedId(state.saved.id);
      // Adopt the slug the server finalized at publish (and lock it via the
      // published state below) so the field and 表示 link reflect the real URL.
      if (state.saved.slug !== null) setSlug(state.saved.slug);
    }
  }

  // A thumbnail marked in the body (ImageBubble.tsx) drops back to the auto-fallback once its
  // image leaves the body: the choice is then stale rather than a deliberate one.
  //
  // **The test is that the image DISAPPEARED, not that it is absent.** ThumbnailField's picker
  // uploads a card image the body need not contain at all, and a bare absence check would wipe
  // that choice on the next keystroke — and again after every reload, where provenance is not
  // stored. Comparing against `handledBody` needs no provenance: only an image that this session
  // saw in the body can be seen to leave it. Ordered so the absence test (usually false, and the
  // only one that runs per keystroke) comes first — the second scan is otherwise paid for by
  // every edit.
  //
  // Adjusted during render, the same sanctioned pattern as the block above: the edit that changed
  // `body` already armed autosave through onUpdate, so this only has state to update, not a side
  // effect to run.
  if (body !== handledBody) {
    setHandledBody(body);
    if (
      thumbnail !== '' &&
      !bodyContainsImage(body, thumbnail) &&
      bodyContainsImage(handledBody, thumbnail)
    ) {
      setThumbnail('');
    }
  }

  useEffect(() => {
    markEditedRef.current = markEdited;
  }, [markEdited]);

  // The WYSIWYG editor. Markdown is the source of truth: content loads from the
  // post's markdown, and every change re-serializes to markdown (kept in `body`
  // and the hidden input) so publish and the public render pipeline are unchanged.
  const editor = useEditor({
    immediatelyRender: false, // required under Next SSR
    shouldRerenderOnTransaction: true, // keep toolbar active states in sync
    extensions: postEditorExtensions(showNotice),
    content: initial.body,
    editorProps: {
      attributes: {
        class:
          'prose prose-zinc dark:prose-invert max-w-none min-h-[480px] px-4 py-3 focus:outline-none',
      },
      // The two pastes that have to be answered ahead of every plugin. First, image files:
      // upload them instead of letting the browser inline them as data URLs (uploadImages is
      // identity-stable — the hook reaches the editor through a ref — so this once-created
      // handler never goes stale). Second, a URL the site cannot publish, for the reason spelled
      // out below.
      handlePaste: (view, event) => {
        const files = imageFilesFromList(event.clipboardData?.files);
        if (files.length > 0) {
          event.preventDefault();
          void uploadImages(files);
          return true;
        }
        // The one hole the link extension's own `isAllowedUri` does not cover. Pasting a URL over
        // a selection is handled by its `linkOnPaste` plugin, which applies the mark with a raw
        // `setMark` — and unlike `setLink`, that never consults `isAllowedUri`. So a scheme this
        // site cannot publish (editor/link-protocols.ts) would slip past everywhere else it is
        // refused, and has to be answered here instead: the props passed to useEditor are asked
        // before every plugin (prosemirror-view's someProp reads `_props` first), which is the
        // only way to get in front of an extension declaring `priority: 1000`.
        //
        // Only the case that plugin claims: a non-empty selection and one line of text. Anything
        // else already reaches a gated path. Replacing the selection with the text is what the
        // paste would have done anyway, minus the link.
        const pasted = event.clipboardData?.getData('text/plain') ?? '';
        if (
          !view.state.selection.empty &&
          pasted &&
          !pasted.includes('\n') &&
          !isPublishableUri(pasted, () => true)
        ) {
          event.preventDefault();
          view.dispatch(view.state.tr.insertText(pasted));
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      setBody(editor.storage.markdown.getMarkdown());
      markEditedRef.current();
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // The post's own address, handed to the link card so it can refuse to point at it
  // (docs/link-card-requirements.md §18). Written into the editor's storage rather than passed
  // with the extension list: the list `useEditor` keeps is the one built on the first render, and
  // in create mode the slug does not exist until autosave has created the row.
  //
  // Through `editorRef` for the reason every other imperative reach into the editor goes through
  // it (the upload hook, the drag containment): it is the handle for work outside React's render
  // flow, and the effect above — declared first, so it runs first — has already filled it.
  useEffect(() => {
    const live = editorRef.current;
    if (live) live.storage.linkCard.ownSlug = slug;
  }, [editor, slug]);

  // Rings whichever image the thumbnail path names (thumbnail-highlight-extension.ts), the same
  // ownSlug pattern above — storage rather than a dispatched transaction, so ImageBubble's toggle
  // doesn't run every plugin's appendTransaction at a moment unrelated to an edit. A layout effect
  // rather than a passive one (ownSlug's is passive and that is fine for it — nothing reads
  // ownSlug back on this same pass): `useEditor`'s own onRender effect calls `setOptions` →
  // `view.updateState` on every render unconditionally, asking every plugin for its decorations
  // again, and React runs all layout effects before any passive one in the same commit — a
  // passive effect here would leave the ring a render behind the click that set it.
  //
  // **`editor`, not `editorRef.current`** — being a layout effect is exactly why. The ref is filled
  // by the passive effect above, and every layout effect in a commit runs before any passive one,
  // so on the one commit that matters — the mount, where `editor` first exists — the ref is still
  // null. The deps then never change again on a post that is merely opened, so the write never
  // happened at all: a saved thumbnail came back from a reload with no badge on it, and no later
  // edit brought it back (measured 2026-09-08, `storage.thumbnailHighlight.path` still `''` after
  // a keystroke). Setting one in the session worked only because that changes `thumbnail`, and by
  // then the ref is filled. See docs/link-card-requirements.md §22.
  useLayoutEffect(() => {
    if (editor) editor.storage.thumbnailHighlight.path = thumbnail;
  }, [editor, thumbnail]);

  // The shared insert dialog opens from the slash menu, which reaches React the only way an
  // extension can: a DOM event on the editor's own element (embed-extension.ts's
  // `openInsertDialog`, docs/embed-requirements.md §24.2). Listened for through `editorRef` for the
  // reason the ownSlug effect uses it — the handle for work outside React's render flow, and a
  // passive effect like that one, so the ref is filled by the time it runs (which is exactly what
  // the layout effect above cannot assume).
  useEffect(() => {
    const live = editorRef.current;
    if (!live) return;
    const dom = live.view.dom;
    const open = (event: Event) => {
      const detail = (event as CustomEvent<InsertDialogDetail>).detail;
      setInsertDialogAt(detail.at);
    };
    dom.addEventListener(INSERT_DIALOG_EVENT, open);
    return () => dom.removeEventListener(INSERT_DIALOG_EVENT, open);
  }, [editor]);

  // Sync the address bar to a newly created post's edit URL without navigating
  // (keeps the editor mounted, cursor intact). Runs once when a create-mode post
  // first gains an identity, whether via autosave or publish.
  useEffect(() => {
    if (committedId === null || urlSyncedRef.current) return;
    urlSyncedRef.current = true;
    window.history.replaceState(null, '', `/admin/posts/${committedId}/edit`);
  }, [committedId]);

  const publishLabel = pending
    ? isPublished
      ? '更新中…'
      : '公開中…'
    : isPublished
      ? '更新'
      : '投稿';
  // Block publish while a brand-new post's first autosave is still creating its
  // row, so a click can't race it into a duplicate post.
  const publishDisabled =
    pending || (isPublished && !pendingPublish) || (!hasIdentity && autosaveState === 'saving');

  const publishStatus = isPublished
    ? pendingPublish
      ? { text: '未公開の変更あり', className: 'text-amber-600' }
      : { text: '公開済み（最新）', className: 'text-green-600' }
    : { text: '未公開', className: 'text-zinc-400' };

  // No 'saving' row: on a local CMS the save round-trip is a blink, so it would
  // flash imperceptibly and says no more than '未保存…' (both mean "not yet
  // persisted"). The 'saving' state still exists internally to gate publish and
  // serialize saves — it just isn't surfaced. A save in flight reads as '未保存…'
  // because `unsaved` stays true until the save succeeds.
  let autosaveStatus: { text: string; className: string } | null = null;
  if (autosaveState === 'failed') {
    autosaveStatus = { text: '保存に失敗', className: 'text-red-600' };
  } else if (unsaved) {
    autosaveStatus = { text: '未保存…', className: 'text-zinc-500' };
  } else if (savedAt !== null) {
    autosaveStatus = { text: '保存済み ✓', className: 'text-green-600' };
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onInput={() => {
        setErrorVisible(false);
        markEdited();
      }}
      onSubmit={() => {
        // A publish carries the current content, so a queued autosave is moot.
        cancelPendingAutosave();
      }}
      className='space-y-5'>
      {sessionExpired && (
        <div
          role='alert'
          className='rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200'>
          セッションが切れました。
          <a
            href='/login'
            target='_blank'
            rel='noopener noreferrer'
            className='mx-1 font-medium underline underline-offset-2'>
            別タブで再ログイン
          </a>
          してください。編集内容は保持されています。
        </div>
      )}
      <div className='grid gap-4 sm:grid-cols-2'>
        <Field label='タイトル'>
          <input
            name='title'
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            className={inputClass}
          />
        </Field>
        <Field label='カテゴリ'>
          <input name='category' defaultValue={initial.category} className={inputClass} />
        </Field>
        <Field label='タグ（カンマ区切り）'>
          <input name='tags' defaultValue={initial.tags.join(', ')} className={inputClass} />
        </Field>
        <Field label='説明'>
          <input name='description' defaultValue={initial.description} className={inputClass} />
        </Field>
        <ThumbnailField value={thumbnail} onChange={applyThumbnail} body={body} />
        <div className='block text-sm'>
          <span className='mb-1 block text-zinc-600 dark:text-zinc-400'>公開範囲</span>
          <label className='mt-2 flex items-center gap-2'>
            <input
              type='checkbox'
              name='unlisted'
              defaultChecked={initial.unlisted}
              className='h-4 w-4 rounded border-zinc-300 accent-violet-600 dark:border-zinc-700'
            />
            <span>限定公開にする</span>
          </label>
        </div>
      </div>

      <div className='space-y-2'>
        {/* The frame must NOT be overflow-hidden: that would make the sticky toolbar
            below pin to the frame instead of the viewport. Its rounded corners are
            preserved by rounding the toolbar's top and the editor content sits within
            px padding, so nothing squares off the border. */}
        <div className='rounded border border-zinc-300 dark:border-zinc-700'>
          {editor && (
            // Toolbar as the frame's sticky header: top-0 pins it to the viewport top
            // (SiteHeader scrolls away, so no offset) so the controls stay reachable
            // when editing far down a long post. The opaque bg hides content scrolling
            // beneath; rounded-t matches the frame's corners and border-b (same weight
            // as the frame) divides the header from the content. z-30 sits above the
            // editor but below the drop overlay (z-50); its own dropdowns (z-50) still
            // open over the content.
            <div className='sticky top-0 z-30 rounded-t border-b border-zinc-300 bg-white px-2 py-0.5 dark:border-zinc-700 dark:bg-zinc-950'>
              <Toolbar editor={editor} uploading={uploading} onImageChange={handleImageChange} />
              {/* Refusal notices hang off the sticky header (which is a containing block for them),
                  so they stay in view over the content — see EditorToast. */}
              {notice && <EditorToast message={notice} />}
            </div>
          )}
          {editor ? (
            <EditorContent editor={editor} />
          ) : (
            <div className='px-4 py-3 text-sm text-zinc-400'>エディタを読み込み中…</div>
          )}
        </div>
        {editor && <TableToolbar editor={editor} />}
        {/* The link card (docs/link-requirements.md §5.5). Sibling of the table toolbar because both
            are BubbleMenus that portal themselves to <body> — neither renders here. */}
        {editor && <LinkBubble editor={editor} onNotice={showNotice} ownSlug={slug} />}
        {editor && (
          <ImageBubble editor={editor} thumbnail={thumbnail} onSetThumbnail={applyThumbnail} />
        )}
        {/* Mounted only while it is open, so closing throws the dialog's state away rather than
            leaving it for the next open to clear. */}
        {editor && insertDialogAt !== null && (
          <InsertDialog
            editor={editor}
            at={insertDialogAt}
            onClose={closeInsertDialog}
            ownSlug={slug}
          />
        )}
      </div>

      <input type='hidden' name='body' value={body} />
      {/* The row identity once it exists (blank for a brand-new post, so publish
          takes the create-and-publish path). */}
      <input type='hidden' name='id' value={committedId ?? ''} />

      {state.error && errorVisible && <p className='text-sm text-red-600'>{state.error}</p>}

      <div className='flex items-center gap-3'>
        <button
          type='submit'
          name='intent'
          value='publish'
          disabled={publishDisabled}
          className='rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300'>
          {publishLabel}
        </button>
        {isPublished && (
          <button
            type='submit'
            name='intent'
            value='unpublish'
            disabled={pending}
            className='rounded border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800'>
            下書きに戻す
          </button>
        )}
        {isPublished && slug && (
          <a
            href={`/posts/${slug}`}
            className='text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'>
            表示
          </a>
        )}
        <span className={`text-xs ${publishStatus.className}`} aria-live='polite'>
          {publishStatus.text}
        </span>
        {autosaveStatus && (
          <span className={`text-xs ${autosaveStatus.className}`} aria-live='polite'>
            {autosaveStatus.text}
          </span>
        )}
      </div>

      {dragging && <DropOverlay />}
    </form>
  );
}
