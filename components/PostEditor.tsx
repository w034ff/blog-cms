'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import type { PostFormState } from '@/app/actions/posts';
import type { DraftContent } from '@/lib/types';
import { ALLOWED_IMAGE_ACCEPT, ALLOWED_IMAGE_MIME_TYPES } from '@/lib/uploads';

export type PostEditorInitial = {
  // Null in create mode; the row id in edit mode.
  id: number | null;
  slug: string;
  title: string;
  date: string;
  description: string;
  category: string;
  tags: string[];
  body: string;
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

const AUTOSAVE_DELAY_MS = 800;

const inputClass =
  'w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400';

const ALLOWED_IMAGE_TYPE_SET = new Set(ALLOWED_IMAGE_MIME_TYPES);

function imageFilesFromList(list: FileList | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((file) => ALLOWED_IMAGE_TYPE_SET.has(file.type));
}

// Build a starting alt text from a dropped/pasted file name: drop the
// extension and turn separators into spaces so it reads as words. It's only a
// placeholder for accessibility — the caller selects it after insertion so the
// author can type a real description over it. Strip characters that would break
// the markdown image (']' closes the alt early; newlines split it).
function altTextFromFilename(name: string): string {
  return name
    .replace(/\.[^./\\]+$/, '')
    .replace(/[[\]\r\n]+/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Snapshot the editable content from the live form DOM. Reading the form (rather
// than mirroring every field into React state) lets the metadata fields stay
// uncontrolled while autosave and publish both see their current values.
function readDraftContent(form: HTMLFormElement): DraftContent {
  const data = new FormData(form);
  const get = (name: string): string => {
    const value = data.get(name);
    return typeof value === 'string' ? value : '';
  };
  const tags = get('tags')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return {
    title: get('title'),
    date: get('date'),
    description: get('description'),
    category: get('category'),
    tags,
    body: get('body'),
  };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className='block text-sm'>
      <span className='mb-1 block text-zinc-600 dark:text-zinc-400'>{label}</span>
      {children}
    </label>
  );
}

type AutosaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function PostEditor({ action, initial, mode, published, hasPendingEdits }: Props) {
  const [state, formAction, pending] = useActionState(action, emptyState);
  const [body, setBody] = useState(initial.body);
  const [title, setTitle] = useState(initial.title);
  // The opaque public slug, only needed to build the 表示 link. Empty in create
  // mode until publish reports the server-assigned slug; otherwise the row's slug.
  const [slug, setSlug] = useState(initial.slug);
  const [html, setHtml] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);
  // The session cookie lapsed mid-edit: preview/autosave/publish return 401. We
  // keep the editor mounted (content intact) and prompt a re-login. Cleared by
  // any successful preview/autosave/publish (proof the session is valid again).
  const [sessionExpired, setSessionExpired] = useState(false);
  const [uploading, setUploading] = useState(false);
  // True while a file is being dragged over the window, so a drop overlay
  // appears on the editor container as a target.
  const [dragging, setDragging] = useState(false);

  // The post's server identity (row id). Null in create mode until the first
  // autosave (or a publish) materializes the row; from then on edits update it.
  const [committedId, setCommittedId] = useState<number | null>(initial.id);
  // Live visibility, and whether the editor holds edits not yet pushed public.
  const [isPublished, setIsPublished] = useState(published);
  const [pendingPublish, setPendingPublish] = useState(hasPendingEdits);
  // Autosave feedback (whether the in-progress work is safely persisted), kept
  // separate from the publish state above — they are two independent axes.
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [unsaved, setUnsaved] = useState(false);

  // A returned server error (e.g. duplicate slug) shows until the next edit, so
  // it doesn't linger while the user fixes the input.
  const [errorVisible, setErrorVisible] = useState(false);
  // Reset visibility whenever a new action result arrives, per React's "adjust
  // state when a value changes" guidance, not in an effect.
  const [handledState, setHandledState] = useState(state);
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
      setUnsaved(false);
      setSavedAt(state.saved.at);
      setAutosaveState('saved');
      setSessionExpired(false);
      if (committedId === null) setCommittedId(state.saved.id);
      // Adopt the slug the server finalized at publish (and lock it via the
      // published state below) so the field and 表示 link reflect the real URL.
      if (state.saved.slug !== null) setSlug(state.saved.slug);
    }
  }

  const viewRef = useRef<EditorView | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Refs mirror state the autosave machinery reads outside React's render flow.
  const committedIdRef = useRef<number | null>(committedId);
  // Edit-mode posts already sit at their final URL; only create-mode posts need
  // a one-time address-bar sync once they gain an identity.
  const urlSyncedRef = useRef(mode === 'edit');
  const publishedRef = useRef(isPublished);
  const unsavedRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const retryRef = useRef(false);
  // Holds the autosave routine (published from an effect below) so the timer,
  // Ctrl/⌘+S flush, and mid-flight retry can invoke it without a stale closure.
  const autosaveRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    committedIdRef.current = committedId;
  }, [committedId]);
  useEffect(() => {
    publishedRef.current = isPublished;
  }, [isPublished]);
  useEffect(() => {
    unsavedRef.current = unsaved;
  }, [unsaved]);

  const hasIdentity = committedId !== null;

  const runAutosave = useCallback(async () => {
    // Serialize saves; if an edit lands mid-flight, retry once we're done.
    if (savingRef.current) {
      retryRef.current = true;
      return;
    }
    const form = formRef.current;
    if (!form) return;
    savingRef.current = true;
    setAutosaveState('saving');
    let ok = false;
    try {
      const content = readDraftContent(form);
      const payload =
        committedIdRef.current === null ? { content } : { id: committedIdRef.current, content };
      const res = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        setSessionExpired(true);
        setAutosaveState('failed');
        return;
      }
      if (!res.ok) {
        setAutosaveState('failed');
        return;
      }
      const data = (await res.json()) as {
        id?: number;
        savedAt?: number;
        created?: boolean;
        skipped?: boolean;
      };
      // Nothing worth saving yet (empty brand-new post): not an error.
      if (data.skipped) {
        ok = true;
        setAutosaveState('idle');
        return;
      }
      // First save of a new post: adopt the server-assigned id and move to its
      // edit URL without a navigation, so the editor (and cursor) stay put.
      if (data.created && typeof data.id === 'number') {
        committedIdRef.current = data.id;
        setCommittedId(data.id);
      }
      ok = true;
      setAutosaveState('saved');
      setSavedAt(typeof data.savedAt === 'number' ? data.savedAt : Date.now());
      setSessionExpired(false);
    } catch {
      setAutosaveState('failed');
    } finally {
      savingRef.current = false;
      if (retryRef.current) {
        retryRef.current = false;
        void autosaveRef.current();
      } else if (ok) {
        unsavedRef.current = false;
        setUnsaved(false);
      }
    }
  }, []);

  // Publish the stable autosave routine to the ref the timer/flush/retry call,
  // so they never capture a stale closure (and we don't write the ref in render).
  useEffect(() => {
    autosaveRef.current = runAutosave;
  }, [runAutosave]);

  const scheduleAutosave = useCallback(() => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void autosaveRef.current();
    }, AUTOSAVE_DELAY_MS);
  }, []);

  // Flush a pending autosave immediately (Ctrl/⌘+S). No-op when nothing is dirty.
  const flushAutosave = useCallback(() => {
    if (!unsavedRef.current) return;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    void autosaveRef.current();
  }, []);

  // Record an edit: mark dirty, flag pending publish for a live post, and (re)arm
  // the autosave debounce.
  const markEdited = useCallback(() => {
    unsavedRef.current = true;
    setUnsaved(true);
    if (publishedRef.current) setPendingPublish(true);
    scheduleAutosave();
  }, [scheduleAutosave]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, []);

  // Debounced live preview (unchanged): render the current body to HTML.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch('/api/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: body }),
          });
          if (!res.ok) {
            if (!cancelled) {
              if (res.status === 401) {
                setSessionExpired(true);
                setPreviewFailed(false);
              } else {
                setPreviewFailed(true);
              }
            }
            return;
          }
          const data = (await res.json()) as { html?: string };
          if (!cancelled) {
            setHtml(typeof data.html === 'string' ? data.html : '');
            setPreviewFailed(false);
            // A successful preview proves the session is valid again — clear the
            // expiry banner (parity with the autosave/publish success paths).
            setSessionExpired(false);
          }
        } catch {
          if (!cancelled) setPreviewFailed(true);
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [body]);

  // Warn before leaving (reload / tab close / external nav) while edits are not
  // yet persisted. Autosave clears `unsaved` on success, so the warning lifts on
  // its own. In-app <Link> navigation is not covered (App Router has no stable
  // block API).
  useEffect(() => {
    if (!unsaved) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [unsaved]);

  // Ctrl/⌘+S flushes the autosave instead of opening the browser's save dialog.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      flushAutosave();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flushAutosave]);

  // Sync the address bar to a newly created post's edit URL without navigating
  // (keeps the editor mounted, cursor intact). Runs once when a create-mode post
  // first gains an identity, whether via autosave or publish.
  useEffect(() => {
    if (committedId === null || urlSyncedRef.current) return;
    urlSyncedRef.current = true;
    window.history.replaceState(null, '', `/admin/posts/${committedId}/edit`);
  }, [committedId]);

  const uploadFile = useCallback(async (file: File): Promise<string | null> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/uploads', { method: 'POST', body: formData });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (res.ok && typeof data.url === 'string') return data.url;
    window.alert(`アップロードに失敗しました: ${data.error ?? res.status}`);
    return null;
  }, []);

  const uploadImages = useCallback(
    async (files: File[], view: EditorView, startPos: number): Promise<void> => {
      setUploading(true);
      try {
        let pos = startPos;
        for (const file of files) {
          const url = await uploadFile(file);
          if (url === null) continue;
          const alt = altTextFromFilename(file.name);
          const snippet = `![${alt}](${url})\n`;
          // Select the alt text (between "![" and "]") so the author can
          // immediately overwrite the filename with a real description.
          const altStart = pos + 2;
          view.dispatch({
            changes: { from: pos, to: pos, insert: snippet },
            selection: { anchor: altStart, head: altStart + alt.length },
          });
          pos += snippet.length;
        }
      } finally {
        setUploading(false);
      }
    },
    [uploadFile],
  );

  // While a file is dragged anywhere over the window, show a drop overlay on the
  // editor container and let a drop add the image at the cursor. Intercepting
  // the drag also stops the browser default (opening the dropped image as a page
  // and navigating away from the editor, losing the draft). Only file drags
  // count, so dragging text within the editor is unaffected. dragenter/dragleave
  // fire for descendants too, so a depth counter tracks whether the pointer is
  // still somewhere over the window before hiding the overlay.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const handleDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth += 1;
      setDragging(true);
    };
    const handleDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        setDragging(false);
      }
    };
    const handleDragOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const handleDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const view = viewRef.current;
      if (!view) return;
      const files = imageFilesFromList(event.dataTransfer?.files);
      if (files.length === 0) return;
      view.focus();
      void uploadImages(files, view, view.state.selection.main.from);
    };
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [uploadImages]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const view = viewRef.current;
    if (view) {
      await uploadImages([file], view, view.state.selection.main.from);
      return;
    }
    setUploading(true);
    try {
      const url = await uploadFile(file);
      if (url !== null) {
        // No editor view here, so we can't select the alt; insert the
        // filename-derived alt as a starting point the author can refine.
        const snippet = `![${altTextFromFilename(file.name)}](${url})`;
        setBody((current) => (current.length > 0 ? `${current}\n${snippet}\n` : `${snippet}\n`));
        markEdited();
      }
    } finally {
      setUploading(false);
    }
  }

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
        if (autosaveTimerRef.current) {
          clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = null;
        }
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
        <Field label='日付'>
          <input
            name='date'
            type='date'
            defaultValue={initial.date.slice(0, 10)}
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
      </div>

      <div className='flex items-center gap-2'>
        <label className='cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'>
          {uploading ? 'アップロード中…' : '画像を挿入'}
          <input
            type='file'
            accept={ALLOWED_IMAGE_ACCEPT}
            className='hidden'
            onChange={handleUpload}
          />
        </label>
        <span className='text-xs text-zinc-500'>
          本文（左）にMDX、右にプレビュー。画像はボタン・貼り付け・ドラッグ&ドロップで挿入
        </span>
      </div>

      <div className='grid gap-4 lg:grid-cols-2'>
        <div className='overflow-hidden rounded border border-zinc-300 dark:border-zinc-700'>
          <CodeMirror
            value={body}
            height='480px'
            extensions={[
              markdown(),
              EditorView.lineWrapping,
              EditorView.domEventHandlers({
                paste(event, view) {
                  const files = imageFilesFromList(event.clipboardData?.files);
                  if (files.length === 0) return false;
                  event.preventDefault();
                  void uploadImages(files, view, view.state.selection.main.from);
                  return true;
                },
              }),
            ]}
            onChange={(value) => {
              setBody(value);
              markEdited();
            }}
            onCreateEditor={(view) => {
              viewRef.current = view;
            }}
          />
        </div>
        <div className='max-h-[520px] overflow-auto rounded border border-zinc-300 p-4 dark:border-zinc-700'>
          {sessionExpired ? (
            <p className='text-sm text-amber-600'>
              セッションが切れたため、プレビューを更新できません。
            </p>
          ) : previewFailed ? (
            <p className='text-sm text-red-600'>プレビューを取得できませんでした。</p>
          ) : (
            <div
              className='prose prose-zinc dark:prose-invert max-w-none'
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
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

      {dragging && (
        // Full-window so the highlighted area matches where a drop is actually
        // accepted (anywhere on the page). marginTop:0 cancels the form's
        // space-y so the fixed layer covers the viewport edge-to-edge.
        <div
          style={{ marginTop: 0 }}
          className='pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-zinc-900/55'>
          <div className='flex flex-col items-center gap-4 text-zinc-900 dark:text-zinc-50'>
            <svg
              xmlns='http://www.w3.org/2000/svg'
              fill='none'
              viewBox='0 0 24 24'
              strokeWidth={1.5}
              stroke='currentColor'
              aria-hidden='true'
              className='h-20 w-20'>
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                d='m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z'
              />
            </svg>
            <span className='text-xl font-medium'>ここに画像をドロップして追加</span>
          </div>
        </div>
      )}
    </form>
  );
}
