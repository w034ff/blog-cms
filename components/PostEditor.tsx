'use client';

import Link from 'next/link';
import { useActionState, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import { postEditorExtensions } from './editor/extensions';
import { isTrailingNodeOnlyUpdate } from './editor/trailing-node-extension';
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

// The button is on the sticky bar and the panel is below it, so aria-controls has to name a
// fixed id rather than rely on the two being nested.
const SETTINGS_PANEL_ID = 'post-settings-panel';

const inputClass =
  'w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400';

// The title is the one metadata field that is always on screen, and the only one whose value
// the reader sees, so it carries the weight the rest of the fields don't — and it is the only
// one that can lose its label. A placeholder only works where the typed value names its own
// field, which is true of a lone 24px bold line and false of カテゴリ「開発」 or タグ; those
// keep their <Field> labels. note and Zenn are both shaped this way (measured 2026-09-11).
//
// No `focus:ring`, so the underline carries visible keyboard focus alone: it is 2px and
// transparent from the start, so focus changes only its colour and never the field's height.
// zinc-500 both ways is a contrast floor, not a shade preference — placeholder text at this
// size is WCAG large text (3:1), and zinc-400 reaches only 2.6:1 on either ground.
const titleClass =
  'w-full border-b-2 border-transparent bg-transparent px-0 py-2 text-2xl font-bold tracking-tight placeholder:text-zinc-500 hover:border-zinc-200 focus:border-zinc-500 focus:outline-none dark:hover:border-zinc-800 dark:focus:border-zinc-500';

// How long 保存済み ✓ stays up after a save. Long enough to be read as an answer to the edit
// just made, short enough that the row is quiet again by the next one.
const SAVED_NOTICE_MS = 3000;

// Enter in a text field submits the form by activating its first submit button, which here
// is 投稿/更新. That was survivable while the publish row sat below a screenful of post;
// with the row pinned in the header, a stray Enter in タイトル publishes. Bound to the
// metadata wrapper, not the <form>, so Enter inside the editor is untouched.
function blockImplicitSubmit(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Enter') return;
  if (event.target instanceof HTMLInputElement) event.preventDefault();
}

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
  // Controlled, though nothing outside the panel reads them any more — the summary that used to
  // report カテゴリ and タグ is gone. Kept as-is rather than returned to `defaultValue` because
  // the form reads the DOM either way (useAutosave snapshots it with `new FormData`), so the
  // change would buy nothing and 説明 already shows the uncontrolled shape works.
  const [category, setCategory] = useState(initial.category);
  const [tags, setTags] = useState(initial.tags.join(', '));
  const [unlisted, setUnlisted] = useState(initial.unlisted);
  // Closed in both modes. Open-on-create was tried and reverted: it pushed the editor ~200px
  // down, below the fold on a 600px-tall window, which is the opposite of what folding these
  // fields away is for. A new post is not left guessing: the category arrives pre-filled
  // (DEFAULT_CATEGORY) and nothing else above is required to publish.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The author's explicit card image ('' = none chosen). Held in React rather
  // than left uncontrolled like the text fields, because the picker writes it
  // and the preview reads it back.
  const [thumbnail, setThumbnail] = useState(initial.thumbnail);
  // The opaque public slug. Nothing on screen shows it — it feeds the link card's
  // self-reference guard (`editor.storage.linkCard.ownSlug`) and nothing else. Empty in
  // create mode until publish reports the server-assigned slug; otherwise the row's slug.
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
  // Bumped on every action result, and used as a `key` to remount the 限定公開 checkbox.
  //
  // React 19 resets the form once a server action settles, and a reset restores each control to
  // its default. A controlled text input is unaffected: React keeps its default in step with the
  // value it renders. A controlled checkbox is not — `defaultChecked` stays false however the box
  // is rendered, so the reset turns it off. React state still says true, and because the rendered
  // `checked` prop did not change between those two renders React never writes the DOM property
  // back, so the box sits unchecked until some later render happens to touch it.
  //
  // Measured 2026-09-13, after 更新 on a post just marked 限定公開: checked=false with
  // defaultChecked=false while the state behind it was still true, and `new FormData(form)` —
  // what autosave and publish both read — reported no `unlisted` at all. Ctrl/⌘+S in that window
  // would have written the working copy back as public. Remounting re-runs the initial DOM write,
  // which is the one path that sets `checked` from the prop unconditionally.
  //
  // Only this field needs it; title, カテゴリ, タグ, 説明, サムネイル and the body all came
  // through the same 更新 intact.
  const [formResetNonce, setFormResetNonce] = useState(0);
  // Whether 保存済み ✓ is still within its moment on screen, and the save it is answering for.
  const [savedNoticeShown, setSavedNoticeShown] = useState(false);
  const [noticedSavedAt, setNoticedSavedAt] = useState<number | null>(null);

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

  // Raise 保存済み ✓ when a save lands. `savedAt` is set afresh by the hook on every successful
  // save (and on a publish, via acceptSaved), so this also re-raises a notice that had already
  // faded. Adjusted during render rather than in an effect, the same way the action result below
  // is — an effect here would be a second render just to show it, and the lint rule that forbids
  // setState in an effect is pointing at exactly that.
  if (savedAt !== noticedSavedAt) {
    setNoticedSavedAt(savedAt);
    setSavedNoticeShown(savedAt !== null);
  }

  // ...and drop it a moment later. `noticedSavedAt` is a dependency, not just the flag: a save
  // landing while the notice is still up leaves the flag already true, so keying on the flag
  // alone would leave the first save's timer running and cut the second notice short.
  useEffect(() => {
    if (!savedNoticeShown) return;
    const timer = setTimeout(() => setSavedNoticeShown(false), SAVED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [savedNoticeShown, noticedSavedAt]);

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
    // Every result, not just a saved one: the reset follows the action settling, not its outcome.
    setFormResetNonce((nonce) => nonce + 1);
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
    onUpdate: ({ editor, transaction, appendedTransactions }) => {
      // The body is synced either way: the document really did change, and this keeps the hidden
      // input equal to it. Only the "an edit happened" signal is withheld — see the helper.
      setBody(editor.storage.markdown.getMarkdown());
      if (isTrailingNodeOnlyUpdate(transaction, appendedTransactions)) return;
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
    // `react-hooks/immutability` reads this as mutating a value a hook returned. `editor` is a
    // TipTap Editor, not React state, and `editor.storage` is the extension-owned box TipTap
    // provides for exactly this — writing to it is the mechanism, not a way around one. It is also
    // the whole point of §22's shape: the alternative, `editor.view.dispatch`, put a transaction in
    // here that ran TrailingNode's appendTransaction at publish time and flipped a freshly
    // published post back to published-pending. Scoped to the line so the rule keeps working everywhere else.
    // eslint-disable-next-line react-hooks/immutability
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

  // Publish state is not written out in words any more (2026-09-13). The publish button already
  // encodes all three, and it is the control the author is looking at: solid and pressable means
  // there is something unpublished, dim (disabled:opacity-50) means the live post is current, and
  // 更新中… means the request is in flight. 未公開の変更あり / 公開済み（最新） / 未公開 each
  // restated one of those in small text beside 保存済み, where the two read as one run of status.
  // `disabled` is a real attribute rather than a colour, so assistive tech still gets the state.
  //
  // It survives as data-publish-state on the row below, which is what the E2E suite waits on.
  const publishState = isPublished
    ? pendingPublish
      ? 'published-pending'
      : 'published-current'
    : 'draft';

  // The autosave state as the row reports it, which is not the hook's own: a save in flight is
  // 'unsaved' here because `unsaved` stays true until it succeeds, and 'idle' means nothing has
  // been saved yet this session. It does NOT follow the notice below out of sight — the fade is
  // presentation, and this is what the E2E suite waits on (e2e/editor-authoring.ts).
  const autosaveDisplayState =
    autosaveState === 'failed'
      ? 'failed'
      : unsaved
        ? 'unsaved'
        : savedAt !== null
          ? 'saved'
          : 'idle';

  // One row for "not persisted yet", covering both the debounce and the request: on a local CMS
  // the round-trip is a blink, so a separate 保存中 row would flash imperceptibly and say no more
  // than this one. The hook's 'saving' state still exists to gate publish and serialize saves; it
  // just isn't surfaced, and `unsaved` stays true until the save succeeds.
  //
  // Worded 保存中…, not 未保存…, though for most of its life (the 800ms debounce) nothing is being
  // saved yet. The author cannot tell queued from in-flight and has no use for the difference,
  // and in a system with no save button 未保存 reads as a fault to be fixed rather than as work
  // being looked after. It also matches 更新中… / 公開中… beside it. The state's own name stays
  // `unsaved` — that one is read by tests and by the beforeunload guard, where "not persisted" is
  // exactly the claim being made.
  //
  // 保存済み ✓ is the one that goes away. It is a confirmation — "that landed" — and `savedAt`
  // never returns to null, so left alone it became the row's permanent furniture after the first
  // save of the session and stopped marking anything. 保存中… reappears on every edit, so the
  // evidence that autosave is alive is still on screen whenever it is the question. 保存に失敗
  // does not fade: absence has to keep meaning "nothing is wrong".
  let autosaveStatus: { text: string; className: string } | null = null;
  if (autosaveState === 'failed') {
    autosaveStatus = { text: '保存に失敗', className: 'text-red-600' };
  } else if (unsaved) {
    autosaveStatus = { text: '保存中…', className: 'text-zinc-500' };
  } else if (savedAt !== null && savedNoticeShown) {
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
      <div className='space-y-3' onKeyDown={blockImplicitSubmit}>
        {/* The way out of the editor, inside the <form> rather than in the layout around it
            (app/admin/posts/layout.tsx used to own it). The form is the boundary that matters
            here: useAutosave reads it with `new FormData(form)`, so anything that has to sit on
            one bar with the post's own fields — 記事の設定 next — has to be on this side of it,
            and a layout wrapping the form cannot reach the state the row reports either. The
            link itself needs none of that; it moves now so the bar can be assembled at all.
            Harmless under blockImplicitSubmit: that guard only cancels Enter on an <input>. */}
        <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
          {/* Hover is a background, not an underline, so this reads as the same kind of control as
              記事の設定 at the other end of the line rather than as prose. `-mx-1` cancels the
              padding the background needs, which keeps the text itself flush with the title's left
              edge below it — the button carries `-mr-1` for the same reason on the right. */}
          <Link
            href='/admin'
            className='-mx-1 rounded px-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'>
            記事一覧
          </Link>
          {/* 記事の設定 rides the same line as the way out rather than the pinned bar below it.
              On that bar its summary sat beside the publish status and 保存中… in the same grey, and
              the two read as one run of status — the failure the back link was measured into
              and out of (2026-09-12). Here the line has one job on each end.

              It gives up being pinned, which is the right thing to give up: metadata is touched
              at the start and the end of writing, and what has to stay reachable from the middle
              of a long post is 投稿. That is still on the bar. */}
          <span className='ml-auto flex flex-wrap items-center gap-2'>
            {/* Only 限定公開 is reported. カテゴリ・タグ・サムネイル always hold a value — a
                category is pre-filled, and 「タグなし」「サムネイルなし」 are the ordinary case —
                so their chips said something on every post and therefore marked nothing. This one
                is absent unless the post is unlisted, which is the state an author can otherwise
                forget they set. */}
            {unlisted && (
              <span className='rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-700 dark:bg-violet-950 dark:text-violet-300'>
                限定公開
              </span>
            )}
            <button
              type='button'
              aria-expanded={settingsOpen}
              aria-controls={SETTINGS_PANEL_ID}
              onClick={() => setSettingsOpen((open) => !open)}
              className='-mr-1 rounded px-1 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800'>
              記事の設定
            </button>
          </span>
        </div>
        {/* No <Field>: the label is the placeholder (titleClass says why). aria-label is not
            optional decoration — a placeholder is not an accessible name (it is inconsistently
            exposed, and gone the moment there is a value). It repeats the placeholder verbatim
            rather than shortening to タイトル so that the name a voice-control user speaks is the
            text they can see (WCAG 2.5.3). The 49 `getByLabel('タイトル')` calls across 26 specs
            still resolve against it: Playwright's getByLabel reads aria-label, and matches a
            substring unless given `exact`. */}
        <input
          name='title'
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          placeholder='記事タイトル'
          aria-label='記事タイトル'
          className={titleClass}
        />
        {/* Below the title, not above it. The toggle is up on the top line and this opens here,
            which separates them — `aria-controls` is what ties them back together. The reason is
            measured: opened above, the panel pushed the title ~280px down and took the post off
            the screen, so the author could not see which post they were setting up.

            `hidden`, never `{settingsOpen && …}`: useAutosave reads the live form with
            `new FormData(form)` and publish reads the same DOM, so a field that leaves the
            document leaves the payload — 限定公開 would silently clear itself and the thumbnail
            would come off. A hidden child is still in both.

            It keeps its own blockImplicitSubmit even though the wrapper around it has one. The
            guard belongs to these fields, not to a position: without it Enter in カテゴリ reaches
            the form's first submit button, which is 投稿, and this panel has already moved twice. */}
        <div
          id={SETTINGS_PANEL_ID}
          hidden={!settingsOpen}
          onKeyDown={blockImplicitSubmit}
          className='space-y-4 rounded border border-zinc-300 px-3 py-4 dark:border-zinc-700'>
          <div className='grid gap-4 sm:grid-cols-2'>
            <Field label='カテゴリ'>
              <input
                name='category'
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label='タグ（カンマ区切り）'>
              <input
                name='tags'
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label='説明'>
            <input name='description' defaultValue={initial.description} className={inputClass} />
          </Field>
          {/* Paired on one row rather than given a grid cell each: the picker is 64px tall and
            the checkbox is one line, so as grid siblings they left the row's baseline ragged. */}
          <div className='flex flex-wrap items-end justify-between gap-6'>
            <ThumbnailField value={thumbnail} onChange={applyThumbnail} body={body} />
            <label className='flex items-center gap-2 pb-1 text-sm'>
              <input
                key={formResetNonce}
                type='checkbox'
                name='unlisted'
                checked={unlisted}
                onChange={(event) => setUnlisted(event.target.checked)}
                className='h-4 w-4 rounded border-zinc-300 accent-violet-600 dark:border-zinc-700'
              />
              <span>限定公開にする</span>
            </label>
          </div>
        </div>
      </div>

      <div className='space-y-2'>
        {/* The frame must NOT be overflow-hidden: that would make the sticky header
            below pin to the frame instead of the viewport. Its rounded corners are
            preserved by rounding the header's top and the editor content sits within
            px padding, so nothing squares off the border. */}
        <div className='rounded border border-zinc-300 dark:border-zinc-700'>
          {/* The frame's sticky header, in two rows: the publish controls above the format
              toolbar. top-0 pins it to the viewport top (SiteHeader scrolls away, so no
              offset) so both stay reachable when editing far down a long post — reaching
              publish used to mean scrolling past the whole post. The opaque bg hides content
              scrolling beneath; rounded-t matches the frame's corners, and each row carries
              its own border-b (same weight as the frame) so the loading state, which has no
              toolbar row, still divides cleanly from the content. z-30 sits above the editor
              but below the drop overlay (z-50); the toolbar's own dropdowns (z-50) still open
              over the content. */}
          <div className='sticky top-0 z-30 rounded-t bg-white dark:bg-zinc-950'>
            {/* Outside the `editor &&` guard below: these are the form's only submit buttons,
                and a mounted editor is not a precondition for publishing — the body travels in
                a hidden input. An editor that fails to mount must not take publish with it. */}
            {/* data-publish-state rides this row rather than an element of its own: with the
                wording gone there is nothing left to put in a status element, and an empty span
                existing only to be queried is a test hook pretending to be UI. The suite waits on
                this after 投稿 (e2e/editor-authoring.ts). It has to be read from the DOM because
                the publish button cannot stand in for it — publishDisabled is true both while the
                request is in flight and after it lands, so the button never separates the two. */}
            <div
              data-publish-state={publishState}
              data-autosave-state={autosaveDisplayState}
              className='flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-300 px-2 py-1 dark:border-zinc-700'>
              {autosaveStatus && (
                <span className={`text-xs ${autosaveStatus.className}`} aria-live='polite'>
                  {autosaveStatus.text}
                </span>
              )}
              {/* No 表示 link here any more. It navigated out of a mounted editor in the same
                  tab, from a row that is pinned to the top of the screen the whole time the post
                  is being written. It lives on the 記事一覧 row instead (app/admin/(list)/page.tsx),
                  which is where a published post is already being handled rather than written. */}
              <div className='ml-auto flex items-center gap-2'>
                {/* Kept ahead of 下書きに戻す: it is the form's first submit button, which is
                    what an Enter pressed in a metadata field activates. */}
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
              </div>
            </div>
            {/* Rides with the publish button rather than sitting where the row used to be, so a
                refused publish is readable from wherever the author clicked it. */}
            {state.error && errorVisible && (
              <p className='border-b border-zinc-300 px-2 py-1 text-sm text-red-600 dark:border-zinc-700'>
                {state.error}
              </p>
            )}
            {editor && (
              <div className='border-b border-zinc-300 px-2 py-0.5 dark:border-zinc-700'>
                <Toolbar editor={editor} uploading={uploading} onImageChange={handleImageChange} />
                {/* Refusal notices hang off the sticky header (which is a containing block for them),
                    so they stay in view over the content — see EditorToast. */}
                {notice && <EditorToast message={notice} />}
              </div>
            )}
          </div>
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

      {dragging && <DropOverlay />}
    </form>
  );
}
