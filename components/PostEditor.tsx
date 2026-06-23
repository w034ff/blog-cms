"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import type { PostFormState } from "@/app/actions/posts";

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
  mode: "create" | "edit";
};

const emptyState: PostFormState = {};

const inputClass =
  "w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-zinc-600 dark:text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}

export function PostEditor({ action, initial, mode }: Props) {
  const [state, formAction, pending] = useActionState(action, emptyState);
  const [body, setBody] = useState(initial.body);
  const [html, setHtml] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: body }),
          });
          if (!res.ok) {
            if (!cancelled) setPreviewFailed(true);
            return;
          }
          const data = (await res.json()) as { html?: string };
          if (!cancelled) {
            setHtml(typeof data.html === "string" ? data.html : "");
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

  function insertAtCursor(text: string): void {
    const view = viewRef.current;
    if (!view) {
      setBody((current) => (current.length > 0 ? `${current}\n${text}\n` : `${text}\n`));
      return;
    }
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
  }

  async function handleUpload(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (res.ok && typeof data.url === "string") {
        insertAtCursor(`![](${data.url})`);
      } else {
        window.alert(`アップロードに失敗しました: ${data.error ?? res.status}`);
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="タイトル">
          <input
            name="title"
            defaultValue={initial.title}
            required
            className={inputClass}
          />
        </Field>
        <Field label="slug（URL・英小文字/数字/ハイフン）">
          <input
            name="slug"
            defaultValue={initial.slug}
            required
            readOnly={mode === "edit"}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            className={`${inputClass} ${mode === "edit" ? "opacity-60" : ""}`}
          />
        </Field>
        <Field label="日付">
          <input
            name="date"
            type="date"
            defaultValue={initial.date.slice(0, 10)}
            required
            className={inputClass}
          />
        </Field>
        <Field label="カテゴリ">
          <input
            name="category"
            defaultValue={initial.category}
            className={inputClass}
          />
        </Field>
        <Field label="タグ（カンマ区切り）">
          <input
            name="tags"
            defaultValue={initial.tags.join(", ")}
            className={inputClass}
          />
        </Field>
        <Field label="説明">
          <input
            name="description"
            defaultValue={initial.description}
            className={inputClass}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="draft" defaultChecked={initial.draft} />
        下書き（公開しない）
      </label>

      <div className="flex items-center gap-2">
        <label className="cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          {uploading ? "アップロード中…" : "画像を挿入"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={handleUpload}
          />
        </label>
        <span className="text-xs text-zinc-500">本文（左）にMDX、右にプレビュー</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
          <CodeMirror
            value={body}
            height="480px"
            extensions={[markdown(), EditorView.lineWrapping]}
            onChange={(value) => setBody(value)}
            onCreateEditor={(view) => {
              viewRef.current = view;
            }}
          />
        </div>
        <div className="max-h-[520px] overflow-auto rounded border border-zinc-300 p-4 dark:border-zinc-700">
          {previewFailed ? (
            <p className="text-sm text-red-600">
              プレビューを取得できませんでした。
            </p>
          ) : (
            <div
              className="prose prose-zinc dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </div>

      <input type="hidden" name="body" value={body} />

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? "保存中…" : "保存"}
      </button>
    </form>
  );
}
