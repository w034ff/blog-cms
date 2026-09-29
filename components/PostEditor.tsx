'use client';

import Link from 'next/link';
import { useActionState, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { PostCategory } from '@/lib/content';
import type { DictionaryTag } from '@/lib/types';
import type { Editor } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import { postEditorExtensions } from './editor/extensions';
import { isTrailingNodeOnlyUpdate } from './editor/trailing-node-extension';
import { isPublishableUri } from './editor/link-protocols';
import { Toolbar } from './editor/Toolbar';
import { TableToolbar } from './editor/TableToolbar';
import { LinkBubble } from './editor/LinkBubble';
import { ImageBubble } from './editor/ImageBubble';
import { InsertDialog } from './editor/InsertDialog';
import { WritingHelpDialog } from './editor/WritingHelpDialog';
import { PostSettingsPanel, SETTINGS_PANEL_ID } from './editor/PostSettingsPanel';
import { INSERT_DIALOG_EVENT, type InsertDialogDetail } from './editor/embed-extension';
import { DropOverlay } from './editor/DropOverlay';
import { EditorToast } from './editor/EditorToast';
import { useAutosave } from './editor/useAutosave';
import { imageFilesFromList, useImageUpload } from './editor/useImageUpload';
import { useEditorNotice } from './editor/useEditorNotice';
import { useDragContainment } from './editor/useDragContainment';
import { useMeasuredHeight } from './editor/useMeasuredHeight';
import { useKeyboardInset } from './editor/useKeyboardInset';
import { InsertMenu } from './editor/InsertMenu';
import { EditorTooltip } from './editor/EditorTooltip';
import { ArrowLeftIcon } from './editor/svg/ArrowLeftIcon';
import { SettingsIcon } from './editor/svg/SettingsIcon';
import { HelpIcon } from './editor/svg/HelpIcon';
import { EditorColumn } from './PageShell';
import { bodyContainsImage } from '@/lib/thumbnail';
import { EDIT_POST_TITLE, tabTitle } from '@/app/shared-metadata';
import type { PostFormState } from '@/app/actions/posts';

export type PostEditorInitial = {
  // Null in create mode; the row id in edit mode.
  id: number | null;
  slug: string;
  title: string;
  category: PostCategory;
  tags: string[];
  body: string;
  thumbnail: string;
};

type Props = {
  action: (prev: PostFormState, formData: FormData) => Promise<PostFormState>;
  initial: PostEditorInitial;
  mode: 'create' | 'edit';
  // Current visibility of the live post: true once it has been published.
  published: boolean;
  // Its publish date is set (and survives a return to draft); 記事の設定's 公開 switch exists only then
  // (docs/editor-requirements.md §12.27).
  everPublished: boolean;
  // A published post whose loaded content is a working copy ahead of the live one. False in create
  // mode.
  hasPendingEdits: boolean;
  // The tag dictionary (lib/tags.ts), for 記事の設定's タグ field to pick from.
  tagDictionary: DictionaryTag[];
};

const emptyState: PostFormState = {};

// The title is always on screen and is what readers see, so it carries the weight and can lose its
// label: a placeholder works where the value names its own field, true of a lone 24px bold line,
// not of カテゴリ or タグ.
//
// No `focus:ring`: the 2px underline, transparent from the start, carries focus by colour alone
// without changing height. zinc-500 is a contrast floor: large-text 3:1, which zinc-400 misses.
const titleClass =
  'w-full border-b-2 border-transparent bg-transparent px-0 py-2 text-2xl font-bold tracking-tight placeholder:text-zinc-500 hover:border-zinc-200 focus:border-zinc-500 focus:outline-none dark:hover:border-zinc-800 dark:focus:border-zinc-500';

// 保存済み ✓'s time on screen: read as an answer to the edit, gone by the next one.
const SAVED_NOTICE_MS = 3000;

// Enter in a text field activates the form's first submit button, 投稿/更新, which is pinned in the
// header. Bound to the metadata wrapper, not the <form>, so Enter in the editor is untouched.
function blockImplicitSubmit(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Enter') return;
  if (event.target instanceof HTMLInputElement) event.preventDefault();
}

export function PostEditor({
  action,
  initial,
  mode,
  published,
  everPublished: initialEverPublished,
  hasPendingEdits,
  tagDictionary,
}: Props) {
  const [state, formAction, pending] = useActionState(action, emptyState);
  // The body's markdown, mirrored into a hidden input that autosave and publish read.
  const [body, setBody] = useState(initial.body);
  const [title, setTitle] = useState(initial.title);
  // Controlled, though only the panel reads them; the form reads the DOM either way (`new
  // FormData`), so returning to `defaultValue` would buy nothing.
  const [category, setCategory] = useState(initial.category);
  // Slugs; one deleted from the dictionary since this copy was saved is dropped here.
  const [tags, setTags] = useState(() =>
    initial.tags.filter((slug) => tagDictionary.some((tag) => tag.slug === slug)),
  );
  // Closed in both modes: open on create pushed the editor below the fold. The one field a publish
  // needs, カテゴリ (§12.32), is named by the refusal.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Where focus returns when 記事の設定 closes (PostSettingsPanel.tsx, §12.29).
  const settingsToggleRef = useRef<HTMLButtonElement>(null);
  // ヘルプ (docs/cms-features.md「書き方ヘルプ」). Held here because the sheet mounts outside the header,
  // whose `sticky` `z-40` is a stacking context (InsertMenu.tsx says why that matters).
  const [helpOpen, setHelpOpen] = useState(false);
  // The explicit card image ('' = none). Controlled: the picker writes it and the preview reads it.
  const [thumbnail, setThumbnail] = useState(initial.thumbnail);
  // The opaque public slug, shown nowhere; it feeds the link card's self-reference guard
  // (`editor.storage.linkCard.ownSlug`). Empty in create mode until the first autosave creates the
  // row.
  const [slug, setSlug] = useState(initial.slug);
  // The session lapsed mid-edit (autosave/publish got 401): the editor stays mounted and prompts a
  // re-login. Cleared by any successful save.
  const [sessionExpired, setSessionExpired] = useState(false);
  // The shared insert dialog; React renders it, and `editor.storage` does not re-render.
  const [insertDialogAt, setInsertDialogAt] = useState<number | null>(null);
  // Stable, so the dialog's Escape listener registers once per open.
  const closeInsertDialog = useCallback(() => setInsertDialogAt(null), []);
  // The ＋ drawer's state, lifted out of InsertMenu.tsx: InsertDialog is its sibling here and
  // reopens the sheet on cancel (insert-menu-nav.ts says why not through the nav context).
  const [insertMenuOpen, setInsertMenuOpen] = useState(false);
  // For the `openInsertDialog` handler, registered once per `editor`, which would read a stale
  // value.
  const insertMenuOpenRef = useRef(insertMenuOpen);
  useLayoutEffect(() => {
    insertMenuOpenRef.current = insertMenuOpen;
  }, [insertMenuOpen]);
  // Whether this InsertDialog session came from the drawer's リンク row, snapshot at open: from the
  // slash menu a cancel must not reopen the sheet.
  const insertDialogFromDrawer = useRef(false);

  // The row id; null in create mode until the first autosave or publish creates the row.
  const [committedId, setCommittedId] = useState<number | null>(initial.id);
  // Live visibility, and whether the editor holds edits not yet pushed public.
  const [isPublished, setIsPublished] = useState(published);
  const [pendingPublish, setPendingPublish] = useState(hasPendingEdits);
  const [everPublished, setEverPublished] = useState(initialEverPublished);
  // Whether 保存済み ✓ is still within its moment on screen, and the save it is answering for.
  const [savedNoticeShown, setSavedNoticeShown] = useState(false);
  const [noticedSavedAt, setNoticedSavedAt] = useState<number | null>(null);

  // A returned server error shows until the next edit.
  const [errorVisible, setErrorVisible] = useState(false);
  const [handledState, setHandledState] = useState(state);
  // The last `body` the thumbnail-staleness check below has already reacted to — see there.
  const [handledBody, setHandledBody] = useState(body);

  const formRef = useRef<HTMLFormElement>(null);
  // Publishes the header's measured height on the form, for the toolbar to pin against.
  const headerRef = useMeasuredHeight<HTMLDivElement>(formRef, '--editor-header-h');
  // The toolbar's height, for the post's bottom padding when the bar is fixed (app/globals.css,
  // `hover: none`).
  const toolbarRef = useMeasuredHeight<HTMLDivElement>(formRef, '--editor-toolbar-h');
  useKeyboardInset(formRef);
  // Refs mirror state the autosave machinery reads outside React's render flow.
  const committedIdRef = useRef<number | null>(committedId);
  // Only a create-mode post syncs the address bar, once, on gaining an identity.
  const urlSyncedRef = useRef(mode === 'edit');
  const publishedRef = useRef(isPublished);
  // A hedge: @tiptap/react re-reads option callbacks each render (`this.options.current.onUpdate`),
  // and markEdited is stable anyway. Kept because a stale closure would silently stop recording
  // edits.
  const markEditedRef = useRef<() => void>(() => {});
  // The live editor, for work outside React's render flow; filled by an effect.
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    committedIdRef.current = committedId;
  }, [committedId]);
  useEffect(() => {
    publishedRef.current = isPublished;
  }, [isPublished]);

  const hasIdentity = committedId !== null;

  // The hook owns dirty/debounce/save; publish-flow state stays here, updated through these.
  const handleCreated = useCallback((id: number, createdSlug: string) => {
    setCommittedId(id);
    // The slug the row was created with (§18), so the card picker can tell this post from others.
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

  // One refusal notice for the whole editor, so two refusals cannot raise two toasts.
  const { notice, showNotice } = useEditorNotice();

  // The thumbnail setter for every caller (ThumbnailField's picker and 解除, ImageBubble's toggle):
  // plain `setThumbnail` would not arm autosave, since no native form event reports it (the file
  // input has no `name`, and the uploaded path arrives a fetch later).
  const applyThumbnail = useCallback(
    (next: string) => {
      setThumbnail(next);
      markEdited();
    },
    [markEdited],
  );

  // タグ's setter, likewise: chip changes rewrite the hidden `tags` input with no `input` event.
  const applyTags = useCallback(
    (next: string[]) => {
      setTags(next);
      markEdited();
    },
    [markEdited],
  );

  const { uploading, dragging, uploadImages, handleImageChange } = useImageUpload(
    editorRef,
    showNotice,
  );

  // Keep an editor drag off the fields beside it: the browser's own move would delete the range.
  useDragContainment(editorRef);

  // Raise 保存済み ✓ on each save (`savedAt` is fresh every time, publish included), during render
  // rather than in an effect, as the lint rule asks.
  if (savedAt !== noticedSavedAt) {
    setNoticedSavedAt(savedAt);
    setSavedNoticeShown(savedAt !== null);
  }

  // Drop it later. Keyed on `noticedSavedAt`, or a save during the notice would keep the first
  // timer and cut the second short.
  useEffect(() => {
    if (!savedNoticeShown) return;
    const timer = setTimeout(() => setSavedNoticeShown(false), SAVED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [savedNoticeShown, noticedSavedAt]);

  // A new action result resets visibility, during render per React's guidance.
  if (state !== handledState) {
    setHandledState(state);
    setErrorVisible(Boolean(state.error));
    // A カテゴリ refusal opens 記事の設定 onto the field (§12.32).
    if (state.missingCategory) setSettingsOpen(true);
    // The result, adjusted during render; the URL side effect is an effect below.
    if (state.sessionExpired) {
      setSessionExpired(true);
    } else if (state.saved) {
      setIsPublished(state.saved.published);
      if (state.saved.published) setEverPublished(true);
      setPendingPublish(false);
      acceptSaved(state.saved.at);
      setSessionExpired(false);
      if (committedId === null) setCommittedId(state.saved.id);
      // The row's slug, as the server reports it.
      if (state.saved.slug !== null) setSlug(state.saved.slug);
    }
  }

  // A thumbnail marked in the body (ImageBubble.tsx) falls back once its image leaves the body.
  // **The image must disappear, not merely be absent**: the picker's choice need not be in the
  // body, and provenance is not stored across reloads, so only an image this session saw can leave.
  // The cheap absence test runs first. During render: the edit already armed autosave.
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

  // Markdown is the source of truth: content loads from it and every change re-serializes into
  // `body`, so publish and the public pipeline are unchanged.
  const editor = useEditor({
    immediatelyRender: false, // required under Next SSR
    shouldRerenderOnTransaction: true, // keep toolbar active states in sync
    extensions: postEditorExtensions(showNotice),
    content: initial.body,
    editorProps: {
      attributes: {
        class:
          'prose prose-zinc dark:prose-invert max-w-none min-h-[480px] py-3 focus:outline-none',
      },
      // Two pastes answered ahead of every plugin: image files are uploaded rather than inlined as
      // data URLs (uploadImages is stable, so this handler never goes stale), and an unpublishable
      // URL.
      handlePaste: (view, event) => {
        const files = imageFilesFromList(event.clipboardData?.files);
        if (files.length > 0) {
          event.preventDefault();
          void uploadImages(files);
          return true;
        }
        // `linkOnPaste` applies its mark with a raw `setMark`, never asking `isAllowedUri`, so an
        // unpublishable scheme (link-protocols.ts) is answered here: useEditor props are asked
        // before every plugin (`someProp` reads `_props` first), the only way ahead of `priority:
        // 1000`. Only that plugin's case: a selection and one line; the text replaces it, minus the
        // link.
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
      // Synced either way; only the "edit happened" signal is withheld (see the helper).
      setBody(editor.storage.markdown.getMarkdown());
      if (isTrailingNodeOnlyUpdate(transaction, appendedTransactions)) return;
      markEditedRef.current();
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // The post's address for the link card's self-refusal (docs/link-card-requirements.md §18).
  // Through storage, since `useEditor` keeps the first render's extension list and the slug may
  // come later; through `editorRef`, the handle for work outside render, filled by the effect
  // above.
  useEffect(() => {
    const live = editorRef.current;
    if (live) live.storage.linkCard.ownSlug = slug;
  }, [editor, slug]);

  // Rings the thumbnail image (thumbnail-highlight-extension.ts) via storage, not a transaction, so
  // no plugin's appendTransaction runs off an edit. A layout effect: `useEditor` re-asks
  // decorations on every render and layout effects run before passive ones, so a passive one lags a
  // render.
  //
  // **`editor`, not `editorRef.current`**: the ref is filled by a passive effect, so on mount it is
  // still null here, and on a post only opened the deps never change again; a saved thumbnail lost
  // its badge after a reload (docs/link-card-requirements.md §22).
  useLayoutEffect(() => {
    // `react-hooks/immutability` sees a mutated hook value; `editor.storage` is TipTap's box for
    // this. A dispatched transaction instead ran TrailingNode's append at publish and flipped the
    // post back to published-pending (§22). Scoped to the line.
    // eslint-disable-next-line react-hooks/immutability
    if (editor) editor.storage.thumbnailHighlight.path = thumbnail;
  }, [editor, thumbnail]);

  // The slash menu opens the dialog via a DOM event on the editor element (embed-extension.ts's
  // `openInsertDialog`, docs/embed-requirements.md §24.2), heard through `editorRef` in a passive
  // effect, when the ref is filled.
  useEffect(() => {
    const live = editorRef.current;
    if (!live) return;
    const dom = live.view.dom;
    const open = (event: Event) => {
      const detail = (event as CustomEvent<InsertDialogDetail>).detail;
      insertDialogFromDrawer.current = insertMenuOpenRef.current;
      setInsertDialogAt(detail.at);
    };
    dom.addEventListener(INSERT_DIALOG_EVENT, open);
    return () => dom.removeEventListener(INSERT_DIALOG_EVENT, open);
  }, [editor]);

  // Sync the address bar to a new post's edit URL without navigating, once it gains an identity.
  // Without a navigation no metadata runs, so the tab title is set here to match the edit page's.
  useEffect(() => {
    if (committedId === null || urlSyncedRef.current) return;
    urlSyncedRef.current = true;
    window.history.replaceState(null, '', `/admin/posts/${committedId}/edit`);
    document.title = tabTitle(EDIT_POST_TITLE);
  }, [committedId]);

  const publishLabel = pending
    ? isPublished
      ? '更新中…'
      : '公開中…'
    : isPublished
      ? '更新'
      : '投稿';
  // No publish while a new post's first autosave is creating its row, or it would race into a
  // duplicate (e2e/publish-race-guard.spec.ts).
  const publishDisabled =
    pending || (isPublished && !pendingPublish) || (!hasIdentity && autosaveState === 'saving');

  // Publish state is not written out: the button encodes it (solid when there is something to
  // publish, dim when current, 更新中… in flight), and wording beside 保存済み read as one run of status.
  // `disabled` is a real attribute, so assistive tech gets it. data-publish-state carries it for
  // the E2E suite.
  const publishState = isPublished
    ? pendingPublish
      ? 'published-pending'
      : 'published-current'
    : 'draft';

  // The header's autosave state, not the hook's: in flight is 'unsaved' (true until success),
  // 'idle' is nothing saved yet. It does not follow the notice's fade; the E2E suite waits on it
  // (e2e/editor-authoring.ts).
  const autosaveDisplayState =
    autosaveState === 'failed'
      ? 'failed'
      : unsaved
        ? 'unsaved'
        : savedAt !== null
          ? 'saved'
          : 'idle';

  // One row for "not persisted yet", debounce and request alike: on a local server a separate 保存中
  // would flash. Worded 保存中…, not 未保存…, which reads as a fault when there is no save button; the
  // state keeps the name `unsaved`, which tests and the beforeunload guard read.
  //
  // 保存済み ✓ fades: `savedAt` never returns to null, so it became permanent furniture. 保存中…
  // returns on every edit. 保存に失敗 does not fade: absence must mean nothing is wrong.
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
      className='post-editor space-y-5'>
      {/* The header bar: the way out, autosave state, settings and publish. **A direct child of
          the <form>**: useAutosave reads `new FormData(form)` and these are its submit buttons,
          and `position: sticky` holds only while the parent's box is on screen, which the
          form's is to the end of the post. z-40: above the toolbar (z-30), below the drop
          overlay and dropdowns (z-50); opaque, as the post scrolls under it.

          It spans the window (`-mx-4` cancels PageMain's padding, `px-4` restores it, `mx-auto
          max-w-editor` inside; app/globals.css widens both on a pointer), SiteHeader's shape, so
          app/admin/posts/layout.tsx gives PageMain no column. `-mt-8` cancels PageMain's top padding: this page starts with chrome.

          data-publish-state / data-autosave-state live only here: the suite queries them
          unqualified, so a second copy fails on strict mode. */}
      <div
        ref={headerRef}
        data-publish-state={publishState}
        data-autosave-state={autosaveDisplayState}
        // `editor-header-bar` (app/globals.css) drops the header's buttons to 34px, under the 40px
        // floor; that rule says why.
        className='editor-header-bar sticky top-0 z-40 -mx-4 -mt-8 border-b border-zinc-300 bg-background px-4 py-2 dark:border-zinc-700'>
        <div className='mx-auto flex max-w-editor flex-wrap items-center gap-x-3 gap-y-1'>
          {/* **Icon alone on both surfaces** (docs/editor-requirements.md §12.6), named by
              `aria-label` with an `EditorTooltip` on hover: the header is three icons and the
              publish button. `-mx-1` keeps the glyph flush with the title's edge. With nothing
              painted, WCAG 2.5.3 does not apply; the tooltip is `aria-hidden`. */}
          <Link
            href='/admin'
            aria-label='記事一覧'
            // A native `<a>` drag on touch fires `dragstart`, and Chrome cancels the pointer
            // sequence before `click`.
            onDragStart={(event) => event.preventDefault()}
            className='toolbar-button editor-back-link group/tt relative -mx-1 inline-flex items-center rounded px-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'>
            <ArrowLeftIcon />
            <EditorTooltip label='記事一覧' />
          </Link>
          {/* On the left with the autosave state: this end says what is true of the post, the
              other what can be done. Ahead of the autosave state (see there). */}
          {/* Last in the group: the only item whose width changes, on every edit, so anything
              after it would shift. A reserved width would hard-code the widest string. */}
          {autosaveStatus &&
            (autosaveState === 'failed' ? (
              // Full words at every size: rare, and worth the room.
              <span className={`text-xs ${autosaveStatus.className}`} aria-live='polite'>
                {autosaveStatus.text}
              </span>
            ) : (
              <>
                <span
                  className={`autosave-status-full text-xs ${autosaveStatus.className}`}
                  aria-live='polite'>
                  {autosaveStatus.text}
                </span>
                {/* Touch copy, 保存済み only, gated on `unsaved` like `autosaveStatus`: the hook's
                    'saving' covers too narrow a slice and left this never rendering. 保存中… on
                    every keystroke is not worth a glyph on touch; 保存に失敗 still interrupts.
                    `aria-label` keeps the word. */}
                {!unsaved && (
                  <span
                    className='autosave-status-compact hidden text-xs text-green-600'
                    aria-live='polite'
                    aria-label={autosaveStatus.text}>
                    ✓
                  </span>
                )}
              </>
            ))}
          <span className='ml-auto flex flex-wrap items-center gap-2'>
            {/* 囲み枠・表・リンク・画像 on a phone, the toolbar on a pointer (docs/editor-requirements.md
                §12.5). `editor &&` is this bar's one gate: publish must survive an editor that
                fails to mount, but these are editor commands. */}
            {editor && (
              <InsertMenu
                editor={editor}
                uploading={uploading}
                onImageChange={handleImageChange}
                open={insertMenuOpen}
                onOpenChange={setInsertMenuOpen}
              />
            )}
            {/* ヘルプ (docs/cms-features.md「書き方ヘルプ」§2), pointer only (`editor-help-button`,
                app/globals.css says why). No `editor &&`: it is content about the editor. The
                icon is `aria-hidden`, so the label is on the button. */}
            <button
              type='button'
              aria-label='ヘルプ'
              aria-haspopup='dialog'
              onClick={() => setHelpOpen(true)}
              className='editor-help-button toolbar-button group/tt relative inline-flex items-center rounded px-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'>
              <HelpIcon />
              <EditorTooltip label='ヘルプ' />
            </button>
            {/* A gear on both surfaces (docs/editor-requirements.md §12.8): ⋮ would read as an
                overflow menu, not one named group. The word is `aria-label` and tooltip;
                `aria-expanded` carries the state. */}
            <button
              type='button'
              ref={settingsToggleRef}
              aria-expanded={settingsOpen}
              aria-controls={SETTINGS_PANEL_ID}
              aria-label='記事の設定'
              onClick={() => setSettingsOpen((open) => !open)}
              // ToolbarButton's `active` fill while open, which this older button lacked.
              className={`toolbar-button editor-settings-link group/tt relative -mr-1 inline-flex items-center rounded px-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 ${settingsOpen ? 'bg-zinc-200 dark:bg-zinc-700' : ''}`}>
              <SettingsIcon />
              <EditorTooltip label='記事の設定' />
            </button>
            {/* A rule between a toggle and the publish button, as Zenn draws it; `aria-hidden`. */}
            <span aria-hidden='true' className='h-5 w-px bg-zinc-300 dark:bg-zinc-600' />
            {/* The form's first submit button, what Enter in a field would activate (hence
                blockImplicitSubmit); the 公開 switch comes later in the form. */}
            <button
              type='submit'
              name='intent'
              value='publish'
              disabled={publishDisabled}
              // `editor-publish-button` (app/globals.css) pins 投稿 to the header's 34px on touch.
              className='editor-publish-button button-primary px-4 py-2 text-sm font-medium disabled:pointer-events-none disabled:opacity-50'>
              {publishLabel}
            </button>
          </span>
        </div>
        {/* In the pinned bar, readable wherever 投稿 was pressed; the toolbar's offset is
            measured, so it follows. Not for カテゴリ, said under the field (§12.32). */}
        {state.error && errorVisible && !state.missingCategory && (
          <p className='mx-auto max-w-editor px-1 pt-1 text-sm text-red-600'>{state.error}</p>
        )}
      </div>
      <EditorColumn>
        <div className='space-y-5'>
          {/* Below the header, so it scrolls away; 保存に失敗 stays in the bar. */}
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
          {/* The title and settings: blockImplicitSubmit guards every input in here. */}
          <div className='space-y-3' onKeyDown={blockImplicitSubmit}>
            {/* No <Field>: the placeholder is the label (see titleClass). aria-label repeats it
                verbatim, since a placeholder is no accessible name and a voice user speaks what
                they see (WCAG 2.5.3); specs' `getByLabel('タイトル')` matches it as a substring. */}
            {/* `required` refuses a titleless 投稿 (§12.34); the bubble says タイトル, cleared on
                each edit (a standing custom message keeps it invalid). The scroll margin is the
                measured header height, or the browser's minimal scroll leaves the field under
                it. */}
            <input
              name='title'
              value={title}
              onChange={(event) => {
                event.target.setCustomValidity('');
                setTitle(event.target.value);
              }}
              onInvalid={(event) => {
                if (event.currentTarget.validity.valueMissing) {
                  event.currentTarget.setCustomValidity('タイトルを入力してください。');
                }
              }}
              required
              placeholder='記事タイトル'
              aria-label='記事タイトル'
              className={`${titleClass} scroll-mt-[calc(var(--editor-header-h)+1rem)]`}
            />
          </div>

          {/* A modal (PostSettingsPanel.tsx says why); `aria-controls` ties the toggle to it. A
              sibling of the `space-y-3` wrapper, and its `!mb-0` keeps it safe from `space-y-*`
              anyway. */}
          <PostSettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            category={category}
            onCategoryChange={setCategory}
            tags={tags}
            onTagsChange={applyTags}
            tagDictionary={tagDictionary}
            thumbnail={thumbnail}
            onThumbnailChange={applyThumbnail}
            body={body}
            isPublished={isPublished}
            everPublished={everPublished}
            publishToggleDisabled={pending || (!hasIdentity && autosaveState === 'saving')}
            error={state.error && errorVisible ? state.error : null}
            categoryError={state.missingCategory && errorVisible ? (state.error ?? null) : null}
            returnFocusRef={settingsToggleRef}
            historyHref={hasIdentity ? `/admin/posts/${committedId}/revisions` : null}
            historyDisabled={unsaved || pending}
          />

          <div className='space-y-2'>
            {/* Not overflow-hidden, or the toolbar would pin to the frame, not the viewport. */}
            <div className='rounded border border-zinc-300 dark:border-zinc-700'>
              {/* The format toolbar, pinned under the page header at the measured
                  `--editor-header-h` (useMeasuredHeight.ts; first-paint fallback in
                  app/globals.css). z-30: above the content, below the page header (z-40) and
                  overlays (z-50). Inside `editor &&`, which publish must never be: the body is
                  a hidden input, so a failed editor must not take publishing with it. */}
              {editor && (
                <div
                  ref={toolbarRef}
                  className='editor-toolbar-bar sticky top-(--editor-header-h) z-30 rounded-t border-b border-zinc-300 bg-white px-2 py-0.5 dark:border-zinc-700 dark:bg-zinc-950'>
                  <Toolbar
                    editor={editor}
                    uploading={uploading}
                    onImageChange={handleImageChange}
                  />
                  {/* Notices hang off the sticky header to stay in view (EditorToast); on a
                      phone they flip above the bottom bar (app/globals.css). */}
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
            {/* The link card (docs/link-requirements.md §5.5), a BubbleMenu that portals to
                <body>. */}
            {editor && <LinkBubble editor={editor} onNotice={showNotice} ownSlug={slug} />}
            {editor && (
              <ImageBubble editor={editor} thumbnail={thumbnail} onSetThumbnail={applyThumbnail} />
            )}
            {/* Mounted while open, so closing discards its state. */}
            {editor && insertDialogAt !== null && (
              <InsertDialog
                editor={editor}
                at={insertDialogAt}
                onClose={closeInsertDialog}
                onCancel={() => {
                  if (insertDialogFromDrawer.current) setInsertMenuOpen(true);
                }}
                onCommit={() => setInsertMenuOpen(false)}
                ownSlug={slug}
              />
            )}
            {/* Here, not in the header, whose `sticky` `z-40` stacking context would trap a
                `fixed` overlay. */}
            {helpOpen && <WritingHelpDialog onClose={() => setHelpOpen(false)} />}
          </div>
        </div>
      </EditorColumn>

      <input type='hidden' name='body' value={body} />
      {/* Blank for a new post, so publish creates and publishes. */}
      <input type='hidden' name='id' value={committedId ?? ''} />

      {dragging && <DropOverlay />}
    </form>
  );
}
