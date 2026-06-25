'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import type { PostFormState } from '@/app/actions/posts';
import { ALLOWED_IMAGE_ACCEPT, ALLOWED_IMAGE_MIME_TYPES } from '@/lib/uploads';

export type PostEditorInitial = {
  slug: string;
  title: string;
  date: string;
  description: string;
  category: string;
  tags: string[];
  draft: boolean;
  body: string;
};

type Props = {
  action: (prev: PostFormState, formData: FormData) => Promise<PostFormState>;
  initial: PostEditorInitial;
  mode: 'create' | 'edit';
};

const emptyState: PostFormState = {};

const inputClass =
  'w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400';

const ALLOWED_IMAGE_TYPE_SET = new Set(ALLOWED_IMAGE_MIME_TYPES);

function imageFilesFromList(list: FileList | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((file) => ALLOWED_IMAGE_TYPE_SET.has(file.type));
}

// Derive a URL-safe slug matching the server's [a-z0-9]+(?:-[a-z0-9]+)* rule.
// Non-ASCII titles (e.g. Japanese) collapse to '', leaving manual entry.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className='block text-sm'>
      <span className='mb-1 block text-zinc-600 dark:text-zinc-400'>{label}</span>
      {children}
    </label>
  );
}

export function PostEditor({ action, initial, mode }: Props) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, emptyState);
  const [body, setBody] = useState(initial.body);
  const [title, setTitle] = useState(initial.title);
  const [slug, setSlug] = useState(initial.slug);
  const [slugLocked, setSlugLocked] = useState(false);
  const [html, setHtml] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);
  // The session cookie lapsed mid-edit: preview/save return 401. We keep the
  // editor mounted (content intact) and prompt a re-login. Set by the preview
  // 401 path and by a save returning { sessionExpired }; cleared by any
  // successful preview or save (proof the session is valid again).
  const [sessionExpired, setSessionExpired] = useState(false);
  const [uploading, setUploading] = useState(false);
  // True while a file is being dragged over the window, so a drop overlay
  // appears on the editor container as a target.
  const [dragging, setDragging] = useState(false);
  const [fieldsDirty, setFieldsDirty] = useState(false);
  // Baseline the dirty check resets to on each successful save, so the editor
  // can stay mounted and still know when it's back to a clean (saved) state.
  const [savedBody, setSavedBody] = useState(initial.body);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // The saved (live) draft visibility, so the "view" link only appears when
  // the public page would actually resolve. Updated from the server response,
  // since an in-place save keeps this component mounted (initial goes stale).
  const [savedDraft, setSavedDraft] = useState(initial.draft);
  // A returned server error (e.g. duplicate slug) shows until the next edit, so
  // it doesn't linger while the user fixes the input — including when the next
  // submit is blocked client-side by HTML validation, in which case the action
  // (and thus a fresh state) never runs and the stale error would otherwise stay.
  const [errorVisible, setErrorVisible] = useState(false);
  // Reset visibility whenever a new action result arrives (each submit yields a
  // fresh state object), re-showing even an identical message. Done during
  // render per React's "adjust state when a value changes" guidance, not in an
  // effect.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    setErrorVisible(Boolean(state.error));
    if (state.sessionExpired) setSessionExpired(true);
    else if (state.saved) setSessionExpired(false);
  }
  const viewRef = useRef<EditorView | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // The success effect runs only on save (keyed by state), so it reads the
  // latest body through a ref (synced below) rather than depending on it.
  const bodyRef = useRef(body);

  const dirty = fieldsDirty || body !== savedBody;

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

  // Warn before leaving (reload / tab close / external nav) with unsaved
  // changes. Suppressed while a save is in flight; a successful save then
  // resets the dirty baseline, so the warning clears on its own.
  // In-app <Link> navigation is not covered (App Router has no stable block API).
  useEffect(() => {
    if (!dirty || pending) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty, pending]);

  // Save with Ctrl/Cmd+S, intercepting the browser's "save page" dialog.
  // requestSubmit() (not submit()) runs the form action and HTML validation,
  // exactly like clicking the save button. No-op while a save is in flight.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (!pending) formRef.current?.requestSubmit();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pending]);

  useEffect(() => {
    bodyRef.current = body;
  }, [body]);

  // On a successful save, stay in the editor instead of navigating away.
  // Create mode has no edit route yet, so switch to it once (using the
  // server-confirmed slug); subsequent saves are then in-place updates that
  // just reset the dirty baseline and flash a saved indicator.
  useEffect(() => {
    const saved = state.saved;
    if (!saved) return;
    if (mode === 'create') {
      router.replace(`/admin/posts/${saved.slug}/edit`);
      return;
    }
    setSavedBody(bodyRef.current);
    setFieldsDirty(false);
    setSavedAt(saved.at);
    setSavedDraft(saved.draft);
  }, [state, mode, router]);

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
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onInput={() => {
        setFieldsDirty(true);
        setErrorVisible(false);
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
            onChange={(event) => {
              const next = event.target.value;
              setTitle(next);
              if (mode === 'create' && !slugLocked) setSlug(slugify(next));
            }}
            required
            className={inputClass}
          />
        </Field>
        <Field label='slug（URL・英小文字/数字/ハイフン）'>
          <input
            name='slug'
            value={slug}
            onChange={(event) => {
              const next = event.target.value;
              // Clearing the slug resumes auto-follow: regenerate from the
              // current title now, instead of waiting for the next title edit.
              if (next.length === 0) {
                setSlug(slugify(title));
                setSlugLocked(false);
                return;
              }
              setSlug(next);
              setSlugLocked(true);
            }}
            required={mode === 'edit'}
            readOnly={mode === 'edit'}
            placeholder={mode === 'create' ? '空欄なら自動生成（日本語タイトル等）' : undefined}
            pattern='[a-z0-9]+(?:-[a-z0-9]+)*'
            className={`${inputClass} ${mode === 'edit' ? 'opacity-60' : ''}`}
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

      <label className='flex items-center gap-2 text-sm'>
        <input type='checkbox' name='draft' defaultChecked={initial.draft} />
        下書き（公開しない）
      </label>

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
            onChange={(value) => setBody(value)}
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
      {/* Tells the server whether the slug was typed by hand: a manual duplicate
          is reported as an error, an auto-derived one is suffixed (foo-2). */}
      {mode === 'create' && (
        <input type='hidden' name='slugManual' value={slugLocked ? 'true' : 'false'} />
      )}

      {state.error && errorVisible && <p className='text-sm text-red-600'>{state.error}</p>}

      <div className='flex items-center gap-3'>
        <button
          type='submit'
          disabled={pending}
          className='rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300'>
          {pending ? '保存中…' : '保存'}
        </button>
        {mode === 'edit' &&
          (savedDraft ? (
            <span className='text-xs text-zinc-400' title='下書きは公開ページがありません'>
              下書き（非公開）
            </span>
          ) : (
            <a
              href={`/posts/${initial.slug}`}
              className='text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'>
              表示
            </a>
          ))}
        {!dirty && savedAt !== null ? (
          <span className='text-xs text-green-600' aria-live='polite'>
            保存しました ✓
          </span>
        ) : (
          <span className='text-xs text-zinc-500'>Ctrl / ⌘ + S でも保存できます</span>
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
