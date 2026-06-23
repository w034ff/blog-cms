'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className='block text-sm'>
      <span className='mb-1 block text-zinc-600 dark:text-zinc-400'>{label}</span>
      {children}
    </label>
  );
}

export function PostEditor({ action, initial, mode }: Props) {
  const [state, formAction, pending] = useActionState(action, emptyState);
  const [body, setBody] = useState(initial.body);
  const [title, setTitle] = useState(initial.title);
  const [slug, setSlug] = useState(initial.slug);
  const [slugLocked, setSlugLocked] = useState(false);
  const [html, setHtml] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const viewRef = useRef<EditorView | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const dirty = fieldsDirty || body !== initial.body;

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
            if (!cancelled) setPreviewFailed(true);
            return;
          }
          const data = (await res.json()) as { html?: string };
          if (!cancelled) {
            setHtml(typeof data.html === 'string' ? data.html : '');
            setPreviewFailed(false);
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
  // changes. Suppressed while submitting, since a successful save redirects.
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

  async function uploadFile(file: File): Promise<string | null> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/uploads', { method: 'POST', body: formData });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (res.ok && typeof data.url === 'string') return data.url;
    window.alert(`アップロードに失敗しました: ${data.error ?? res.status}`);
    return null;
  }

  async function uploadImages(files: File[], view: EditorView, startPos: number): Promise<void> {
    setUploading(true);
    try {
      let pos = startPos;
      for (const file of files) {
        const url = await uploadFile(file);
        if (url === null) continue;
        const snippet = `![](${url})\n`;
        view.dispatch({
          changes: { from: pos, to: pos, insert: snippet },
          selection: { anchor: pos + snippet.length },
        });
        pos += snippet.length;
      }
    } finally {
      setUploading(false);
    }
  }

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
        setBody((current) => (current.length > 0 ? `${current}\n![](${url})\n` : `![](${url})\n`));
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onInput={() => setFieldsDirty(true)}
      className='space-y-5'>
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
              setSlug(event.target.value);
              setSlugLocked(event.target.value.length > 0);
            }}
            required
            readOnly={mode === 'edit'}
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
                dragover(event) {
                  if (event.dataTransfer?.types.includes('Files')) {
                    event.preventDefault();
                    return true;
                  }
                  return false;
                },
                drop(event, view) {
                  const files = imageFilesFromList(event.dataTransfer?.files);
                  if (files.length === 0) return false;
                  event.preventDefault();
                  const pos =
                    view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
                    view.state.selection.main.from;
                  void uploadImages(files, view, pos);
                  return true;
                },
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
          {previewFailed ? (
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

      {state.error && <p className='text-sm text-red-600'>{state.error}</p>}

      <div className='flex items-center gap-3'>
        <button
          type='submit'
          disabled={pending}
          className='rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300'>
          {pending ? '保存中…' : '保存'}
        </button>
        <span className='text-xs text-zinc-500'>Ctrl / ⌘ + S でも保存できます</span>
      </div>
    </form>
  );
}
