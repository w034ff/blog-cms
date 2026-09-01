'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { EMBED_PROVIDERS, resolveEmbed } from '@/lib/embed-provider';

// The embed's insert dialog (docs/embed-requirements.md §24.1).
//
// **One URL field and a table of what can be embedded.** The reference site's dialog is a row of
// buttons per provider because its editor writes markdown and the author has to produce
// `@[youtube](動画のID)`; here the provider is derived from the URL, so asking which one first
// would be a step that answers a question already answered. The nine rows are read, not pressed —
// they are the only place an author is told what is supported, which is the job the link card
// picker's explanatory line was doing badly (2 providers named of 9).
//
// The list comes from `EMBED_PROVIDERS`, which is derived from the resolver's own registry. A
// hand-kept list would have been wrong four times in the month this feature grew Figma, the gist,
// CodeSandbox and CodePen.
export function EmbedInsertDialog({
  editor,
  at,
  onClose,
}: {
  editor: Editor;
  // Where the embed goes, captured when the slash row ran — and `null` when the dialog is closed,
  // which is the same fact said once instead of as a second `open` flag that could disagree.
  at: number | null;
  onClose: () => void;
}) {
  const open = at !== null;
  const [href, setHref] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const headingId = useId();
  const fieldId = useId();

  // The dialog opens on an empty line the slash menu has just cleared, and the author then types
  // somewhere outside the editor. ProseMirror keeps its selection while the DOM focus is
  // elsewhere, so `setEmbed` still lands where the caret was — `e2e/editor-embed-insert.spec.ts`
  // inserts into the middle of a document rather than an empty one, because an empty one would
  // pass whether that holds or not.
  // Closing hands the caret back. Without this the author is left with focus on nothing — the
  // dialog is gone, the editor is not focused, and the next keystroke goes to the document rather
  // than the post (measured 2026-09-02: a second `/` after Escape opened no menu at all).
  const close = () => {
    // **Cleared, not remembered.** Keeping the abandoned URL would look like resuming, but the
    // dialog opens at wherever the caret is *now* — so the next open would offer to insert the
    // previous URL at a different place, which is the one outcome nobody asked for.
    setHref('');
    editor.commands.focus();
    onClose();
  };

  const insert = () => {
    const value = href.trim();
    if (value === '') return;
    // `focus(at)`, not `focus()`. The caret has been outside the editor while the author typed,
    // and a bare focus restores whatever selection the view holds by then — which put the embed at
    // the end of the document about one run in three (§24.1).
    editor
      .chain()
      .focus(at ?? undefined)
      .setEmbed(value)
      .run();
    setHref('');
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    // Deferred a frame: the element is rendered in this same commit, and focus() on a node the
    // browser has not laid out yet does nothing.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Stopped, or the editor's own Escape handling runs too — and the last thing a dialog should
      // do on the way out is move the caret it is about to insert at.
      event.stopPropagation();
      setHref('');
      editor.commands.focus();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
    // `onClose` is stable (PostEditor wraps it), so this registers once per open rather than once
    // per render — a ref to keep it stable instead is what `react-hooks/refs` refuses.
  }, [open, editor, onClose]);

  if (!open) return null;

  const target = href.trim() === '' ? null : resolveEmbed(href.trim());
  // Which row lights up, and the name the status line uses. **Found by host rather than read from
  // `target.label.lead`**: that field is the strongest thing the URL says about the item, which for
  // X and the gist is the account, not the provider (§10.4, §18). The table names providers.
  const matched =
    target === null
      ? null
      : (EMBED_PROVIDERS.find((provider) => provider.hosts.includes(hostOf(href))) ?? null);
  const status =
    href.trim() === ''
      ? 'URL を貼り付けてください。'
      : matched
        ? `${matched.name} として埋め込みます。`
        : target
          ? 'このURLは埋め込みになります。'
          : 'このURLに対応するサービスがありません。リンクカードにしてください。';

  return (
    <div
      className='fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-start sm:p-8'
      // A click on the sheet itself must not reach this — mousedown rather than click for the
      // reason the link card's rows learned the hard way: a control that unmounts on mousedown
      // lets the mouseup fall through to the document.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}>
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby={headingId}
        // A sheet on a phone, a card on a desktop. The narrow form is not the desktop dialog made
        // smaller: with the soft keyboard up there is ~319px of usable height at 390px, so a
        // centred card is the wrong shape (§24, measured 2026-09-02).
        className='flex max-h-full w-full flex-col overflow-hidden rounded-t-lg border border-zinc-300 bg-white shadow-xl sm:max-w-lg sm:rounded-lg dark:border-zinc-700 dark:bg-zinc-900'
        onMouseDown={(event) => event.stopPropagation()}>
        <div className='flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950'>
          <h2 id={headingId} className='text-sm font-bold'>
            埋め込みを挿入
          </h2>
          {/* type='button' everywhere: PostEditor wraps the editor in one <form>, and a
              default-type button inside it submits the post. */}
          <button
            type='button'
            aria-label='閉じる'
            onClick={close}
            className='rounded-full border border-zinc-300 px-2 py-0.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'>
            ×
          </button>
        </div>

        <div className='flex min-h-0 flex-col gap-2 overflow-y-auto px-4 py-3'>
          <label htmlFor={fieldId} className='text-xs font-bold'>
            埋め込みたいページの URL
          </label>
          <input
            id={fieldId}
            ref={inputRef}
            type='url'
            value={href}
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (target) insert();
              }
            }}
            placeholder='https://…'
            autoComplete='off'
            // Detached from PostEditor's form, so a publish running while this is open cannot
            // blank it (React 19 resets form controls after a server action).
            form='__embed-insert-detached'
            className='rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900'
          />
          <p className='text-xs text-zinc-500 dark:text-zinc-400'>{status}</p>

          <ul className='divide-y divide-zinc-200 overflow-hidden rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800'>
            {EMBED_PROVIDERS.map((provider) => {
              const on = provider === matched;
              return (
                <li
                  key={provider.name}
                  className={`flex items-center gap-3 px-3 py-1.5 text-xs ${
                    on ? 'bg-blue-50 dark:bg-blue-950/40' : ''
                  }`}>
                  <span className='w-28 flex-none font-bold'>{provider.name}</span>
                  <span className='min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400'>
                    {provider.hosts.join(' / ')}
                  </span>
                  {on && (
                    <span className='flex-none text-[11px] font-bold text-blue-600 dark:text-blue-400'>
                      これになります
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className='flex items-center justify-between gap-3 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800'>
          <span className='text-xs text-zinc-500 dark:text-zinc-400'>
            対応 {EMBED_PROVIDERS.length} 件
          </span>
          <button
            type='button'
            onClick={insert}
            disabled={target === null}
            className='rounded bg-blue-600 px-4 py-1.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40'>
            挿入する
          </button>
        </div>
      </div>
    </div>
  );
}

// The host of what the author has typed so far, or '' when it is not a URL yet. Only used to
// decide which row lights up; `resolveEmbed` is what decides whether anything can be inserted.
function hostOf(value: string): string {
  try {
    return new URL(value.trim()).hostname;
  } catch {
    return '';
  }
}
