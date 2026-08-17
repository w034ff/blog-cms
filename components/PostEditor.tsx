'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';
import { MarkdownTable, ParagraphTableCell, ParagraphTableHeader } from './editor/table-extensions';
import { Callout } from './editor/callout-extension';
import {
  MarkdownDetails,
  MarkdownDetailsContent,
  MarkdownDetailsSummary,
} from './editor/details-extension';
import { DropCursorGuard } from './editor/drop-cursor-guard';
import { IsolatingBoundary } from './editor/isolating-boundary';
import { LinkHighlight } from './editor/link-highlight-extension';
import { LinkInputRule } from './editor/link-input-rule';
import { Link } from './editor/link-extension';
import { Blockquote } from './editor/blockquote-extension';
import { TrailingNode } from './editor/trailing-node-extension';
import { Image } from './editor/image-extension';
import { LinkCard } from './editor/link-card-extension';
import { ThumbnailField } from './editor/ThumbnailField';
import { AccentEmphasis } from './editor/accent-emphasis-extension';
import { FootnoteLiteral } from './editor/footnote-literal-extension';
import {
  Document,
  FootnoteDefinition,
  FootnoteReference,
  FootnoteSection,
} from './editor/footnote-extension';
import { isPublishableUri } from './editor/link-protocols';
import { Bold, Italic, Strike, Code } from './editor/guarded-toggle-marks';
import { Heading, BulletList, OrderedList } from './editor/guarded-block-toggles';
import { SlashCommand } from './editor/slash-command';
import { CodeBlockWithLanguage } from './editor/code-block-extension';
import { ClearNodes } from './editor/clear-nodes-extension';
import { BlockDragHandle } from './editor/block-drag-handle';
import { Toolbar } from './editor/Toolbar';
import { TableToolbar } from './editor/TableToolbar';
import { LinkBubble } from './editor/LinkBubble';
import { DropOverlay } from './editor/DropOverlay';
import { EditorToast } from './editor/EditorToast';
import { useAutosave } from './editor/useAutosave';
import { imageFilesFromList, useImageUpload } from './editor/useImageUpload';
import { useEditorNotice } from './editor/useEditorNotice';
import { useDragContainment } from './editor/useDragContainment';
import type { PostFormState } from '@/app/actions/posts';

// tiptap-markdown adds a `markdown` storage exposing getMarkdown(), but ships no
// type augmentation for it — register it here so editor.storage.markdown is typed.
declare module '@tiptap/core' {
  interface Storage {
    markdown: MarkdownStorage;
  }
}

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
  const handleCreated = useCallback((id: number) => setCommittedId(id), []);
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

  useEffect(() => {
    markEditedRef.current = markEdited;
  }, [markEdited]);

  // The WYSIWYG editor. Markdown is the source of truth: content loads from the
  // post's markdown, and every change re-serializes to markdown (kept in `body`
  // and the hidden input) so publish and the public render pipeline are unchanged.
  const editor = useEditor({
    immediatelyRender: false, // required under Next SSR
    shouldRerenderOnTransaction: true, // keep toolbar active states in sync
    extensions: [
      // heading/bulletList/orderedList are replaced by the guarded versions below (same
      // nodes, but they refuse to convert a code block into prose — see
      // guarded-block-toggles.ts), so disable StarterKit's own to avoid a double
      // registration. Heading keeps its level restriction there rather than here.
      // codeBlock is replaced by CodeBlockWithLanguage (adds an in-editor language
      // picker); disable StarterKit's so the `codeBlock` node isn't registered twice.
      // blockquote is likewise replaced by our Blockquote (StarterKit's copy bundles a
      // duplicate prosemirror-state whose Backspace join breaks `instanceof` — see
      // blockquote-extension.ts), so disable it here to avoid a double registration.
      // underline is disabled outright: it had no toolbar button (reachable only via the
      // undocumented Mod-u), and rehype-sanitize's schema (lib/render.ts) doesn't allow a
      // bare <u> tag, so it silently vanished on publish — a WYSIWYG lie with no UI to fix.
      // bold/italic/strike/code are replaced by the guarded versions below (same behavior,
      // but toggling one that's excluded by accentEmphasis is a true no-op — see
      // guarded-toggle.ts), so disable StarterKit's own to avoid a double registration.
      // trailingNode is replaced by ours below: same appended paragraph, but it waits while a
      // just-fired input rule can still be undone, so Backspace after a block shortcut typed at
      // the end of the document restores what was typed — see trailing-node-extension.ts.
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        codeBlock: false,
        blockquote: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
        underline: false,
        trailingNode: false,
        // document is replaced by ours: the same top node, but its content expression admits the
        // footnote definitions' section as an optional last child — see footnote-extension.ts.
        document: false,
        // link is replaced by ours below: the same extension with the mark made non-inclusive, so
        // the 。 typed after a link stays out of it — see editor/link-extension.ts.
        link: false,
      }),
      // Kept (it is what makes a pasted URL a link) but must not open on click: the default sends a
      // left click to window.open, so a link inside the editor could not be clicked into and the
      // caret could never be placed in it — the text was uneditable and, with no toolbar control
      // for links either, unremovable. Only these two options are overridden, so autolink and
      // linkOnPaste keep their defaults (docs/link-requirements.md §3, §4).
      // What this gave up — "open this link" from inside the editor — is handed back by the link
      // card (editor/LinkBubble.tsx), which the caret placement this enables is what triggers.
      //
      // isAllowedUri narrows the schemes a link may use to the ones the public sanitizer will
      // actually publish — see editor/link-protocols.ts for which six drop out and why the gap
      // is closed at this end.
      Link.configure({
        openOnClick: false,
        isAllowedUri: (url, ctx) => isPublishableUri(url, ctx.defaultValidate),
      }),
      Document,
      // Directly under Document because it exists to answer for Document's content expression:
      // `block+ footnoteSection?` makes `ContentMatch.defaultType` return `footnoteSection` past
      // the first child, and TipTap's own `clearNodes` takes that unchecked and throws. Replaces
      // the command with upstream's body picking a *textblock* instead — see
      // clear-nodes-extension.ts. Reachable as Mod-Alt-0 on almost any line of a post.
      ClearNodes,
      TrailingNode,
      // TableKit bundles the table/cell nodes too, but we replace them: MarkdownTable
      // (same node, extended to serialize column alignment) and the paragraph-only
      // cells (markdown can't store block structure inside a cell), so disable its own.
      TableKit.configure({ table: false, tableCell: false, tableHeader: false }),
      // allowTableNodeSelection: prosemirror-tables' tableEditing() otherwise coerces any
      // NodeSelection wrapping a whole `table` into a CellSelection spanning it (an
      // appendTransaction — see its normalizeSelection). BlockDragHandle's drag itself no longer
      // depends on this — it captures the node/range directly at mousedown, so a coerced selection
      // wouldn't break the move — but without this flag the table's "picked up" highlight would
      // flicker from a clean NodeSelection into a CellSelection the instant you grab its handle.
      // Purely cosmetic now; kept for that visual consistency.
      MarkdownTable.configure({ allowTableNodeSelection: true, onBlocked: showNotice }),
      ParagraphTableCell,
      ParagraphTableHeader,
      DropCursorGuard,
      // Keeps a ranged edit (Backspace/Delete over a selection, typing or pasting over one) from
      // closing over a callout's or code block's edge — `isolating` only guards where a slice may
      // be *placed*, not what a replacement joins. See isolating-boundary.ts.
      //
      // Its position here is load-bearing, in both directions. ExtensionManager reverses this array
      // before gathering plugins, so a later entry is asked first: it must stay *above* Callout, so
      // that guard's handlePaste still gets a callout-carrying slice first (handlePaste is
      // first-wins), and it must stay in this array at all, so its keys beat the core Keymap
      // extension's baseKeymap deleteSelection.
      IsolatingBoundary,
      // A decoration-only store: it paints whatever range the link card pushes into it, so the text
      // the card is about is visibly the text the card is about. No keys, no commands, no schema —
      // order among the others doesn't matter. See link-highlight-extension.ts.
      LinkHighlight,
      // `[text](url)` typed in the editor becomes a link. Sits outside the Link configuration above
      // because extension-link has no input rules of its own — see link-input-rule.ts and
      // docs/link-requirements.md §5.4.
      LinkInputRule,
      // Replaces the bare @tiptap/extension-image: same node, but its markdown serializer closes
      // the block, so a quote/fence right after an image isn't glued onto the image's line —
      // see image-extension.ts.
      Image,
      // A post of your own shown as a card instead of a line of link text. Stores only the
      // reference (`<div class="link-card" data-href>`), so the title comes from `posts` at render
      // time on both sides — see docs/link-card-requirements.md and lib/rehype-link-card.ts.
      // Must be registered above Markdown for the same reason Image is: its serializer is what
      // keeps the card out of tiptap-markdown's raw-HTML fallback.
      LinkCard,
      Markdown.configure({ html: true, bulletListMarker: '-', linkify: false, breaks: false }),
      // The backstop under the footnote nodes below, not a leftover from before them. Every
      // definition markdown-it-footnote accepts is claimed before this is asked; what it still
      // catches is the shapes the plugin declines — a label containing a space among them — which
      // `reference` would otherwise take as a link reference definition, turning the note's words
      // into a URL. See footnote-literal-extension.ts.
      FootnoteLiteral,
      // Footnotes (docs/footnote-requirements.md). The reference lives in the prose, the
      // definitions in one section pinned to the end of the document, and `Document` above is
      // replaced only to say that in the schema (`block+ footnoteSection?`, §3.2).
      // FootnoteLiteral above is not in competition with these: markdown-it-footnote registers
      // footnote_def *before* the `reference` rule it patches, so it is only ever asked about the
      // lines the plugin refused (§7.2).
      FootnoteReference.configure({ onBlocked: showNotice, onNotice: showNotice }),
      FootnoteDefinition.configure({ onBlocked: showNotice }),
      FootnoteSection,
      // GitHub-style alert callouts as a real node: the `[!NOTE]` marker shows as a
      // non-editable label chip and only the body is editable, so it can't be broken
      // by typing after the `]`. Serializes back to `> [!TYPE]` markdown, so storage
      // and the public render pipeline are unchanged. `onBlocked` is the same reporter the table
      // guards use: a drop carrying a callout into a quote or another callout is refused, and a
      // refused gesture changes nothing, so the notice is the whole of the feedback.
      Callout.configure({ onBlocked: showNotice }),
      // Replaces StarterKit's blockquote (disabled above): same node/input rule/commands, but
      // its Backspace join uses the canonical TextSelection so the caret survives `instanceof`.
      Blockquote,
      // Zenn-style folding block, stored as raw `<details>`/`<summary>` HTML (markdown has no
      // syntax for it — see docs/accordion-requirements.md). `onBlocked` is the shared notice: a
      // drop carrying an accordion into a quote, list, callout or cell is refused, and a refused
      // gesture changes nothing, so the message is the whole of the feedback.
      MarkdownDetails.configure({ onBlocked: showNotice }),
      MarkdownDetailsSummary,
      MarkdownDetailsContent,
      // `/` at the start of a line opens a small block-insert menu (callouts + code block);
      // choosing a row deletes the `/query` and runs that block's command.
      SlashCommand,
      // Plain code block + an editor-only language <select> (drives Shiki highlighting on
      // the public page); the `language` attribute still round-trips as a ```lang fence.
      CodeBlockWithLanguage,
      // Hover-revealed left-gutter grip on blockquotes/callouts/images/tables/code blocks:
      // click-drag the whole block to reorder it. Editor-only chrome, no markdown/model impact.
      BlockDragHandle,
      // Bold + the site's red accent as one toggle ("強調"). No native markdown syntax, so it
      // round-trips as raw `<span class="accent-emphasis">` (safe under this Markdown
      // extension's `html: true` above) — see accent-emphasis-extension.ts.
      AccentEmphasis,
      // Guarded replacements for StarterKit's bold/italic/strike (disabled above) — see
      // guarded-toggle-marks.ts and guarded-toggle.ts.
      Bold,
      Italic,
      Strike,
      // Guarded replacements for StarterKit's heading/bulletList/orderedList (disabled above):
      // same nodes, but each refuses inside a code block instead of shredding it into prose —
      // see guarded-block-toggles.ts. Body headings stay limited to the two levels the toolbar
      // exposes (大見出し = H2, 小見出し = H3): the post title is the page's only H1, so this
      // also stops a stray `# `/`#### ` markdown shortcut from injecting an H1/H4+.
      Heading.configure({ levels: [2, 3] }),
      BulletList,
      OrderedList,
      // Turn off the browser's native spellcheck for inline `code` marks — code tokens aren't
      // dictionary words, so it paints them with red squiggles (the code block's <code> is
      // likewise opted out in CodeBlockWithLanguage). Prose keeps spellcheck.
      Code.configure({ HTMLAttributes: { spellcheck: 'false' } }),
    ],
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
        <ThumbnailField value={thumbnail} onChange={setThumbnail} body={body} />
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
        {editor && <LinkBubble editor={editor} onNotice={showNotice} />}
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
