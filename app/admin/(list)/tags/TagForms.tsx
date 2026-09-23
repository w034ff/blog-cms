'use client';

import { useActionState, useId, useState } from 'react';
import {
  createTagAction,
  deleteTagAction,
  updateTagAction,
  type TagFormState,
} from '@/app/actions/tags';
import { TAG_NAME_MAX_LENGTH, normalizeTagName, tagSlug, tagSlugProblem } from '@/lib/content';
import type { Tag } from '@/lib/types';

const inputClass =
  'w-full min-w-0 rounded border border-zinc-300 bg-transparent px-3 py-1.5 text-sm focus:ring-2 focus:ring-zinc-400 focus:outline-none dark:border-zinc-700';
const secondaryButtonClass =
  'shrink-0 rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800';
const primaryButtonClass =
  'shrink-0 rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
// One grey for everything secondary on this page (`zinc-500`, `zinc-400` in dark) and the body
// colour for the rest: shades picked one by one had made five greys that meant nothing apart. A
// row's data — identifier, display name, count — is all body colour, the identifier alone a little
// heavier as the row's key; the column headings and each row's 編集, repeated down the right edge,
// stay grey so the data reads before the chrome.
//
// One grid for the header and every row, so the columns line up down the page.
const columnsClass =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3.5rem_3.5rem] items-center gap-x-4';

const initialState: TagFormState = {};

function ErrorLine({ message }: { message: string | undefined | null }) {
  if (!message) return null;
  return (
    <p role='alert' className='mt-2 text-xs text-red-600 dark:text-red-400'>
      {message}
    </p>
  );
}

// A new tag is typed as its identifier, the same as in the editor; its display name starts out
// the same and is changed from its row afterwards.
export function NewTagForm() {
  const [state, action, pending] = useActionState(createTagAction, initialState);
  const [name, setName] = useState('');
  // Cleared once per success, and only then: a refused name stays for the author to fix.
  const [clearedAt, setClearedAt] = useState(state.at);
  if (state.at !== clearedAt) {
    setClearedAt(state.at);
    setName('');
  }
  const problem = tagSlugProblem(name);
  return (
    <form action={action} className='max-w-md'>
      <div className='flex gap-2'>
        <input
          name='name'
          aria-label='新しいタグの識別子'
          placeholder='新しいタグの識別子'
          maxLength={TAG_NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
        <button
          type='submit'
          disabled={pending || name.trim() === '' || problem !== null}
          className={secondaryButtonClass}>
          追加
        </button>
      </div>
      <ErrorLine message={problem ?? state.error} />
    </form>
  );
}

// The dictionary as a read-only table — identifier, display name, how many posts carry it — with
// one row open for editing at a time. Every field, save button and 削除 used to sit open on every
// row at once, which is what made the page read as clutter (2026-09-23).
export function TagTable({
  tags,
  usage,
}: {
  tags: Tag[];
  // Posts per identifier, drafts and pending edits included (lib/tags.ts `tagUsage`).
  usage: Record<string, number>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const slugs = tags.map((tag) => tag.slug);
  return (
    <div>
      <div
        className={`${columnsClass} border-b border-zinc-200 pb-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400`}>
        <span>識別子</span>
        <span>表示名</span>
        <span className='text-right'>記事</span>
        <span />
      </div>
      <ul className='divide-y divide-zinc-200 dark:divide-zinc-800'>
        {tags.map((tag) => (
          <TagRow
            // Keyed by both, so a saved change remounts the row with the server's values.
            key={`${tag.slug}:${tag.name}`}
            tag={tag}
            usage={usage[tag.slug] ?? 0}
            slugs={slugs}
            open={open === tag.slug}
            onOpen={() => setOpen(tag.slug)}
            onClose={() => setOpen(null)}
          />
        ))}
      </ul>
    </div>
  );
}

function TagRow({
  tag,
  usage,
  slugs,
  open,
  onOpen,
  onClose,
}: {
  tag: Tag;
  usage: number;
  slugs: string[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <li className='py-3'>
      <div className={columnsClass}>
        <span className='truncate text-sm font-medium'>{tag.slug}</span>
        {/* Only a display name that differs is shown: the same word twice is the noise this
            table is meant to be without. */}
        <span className='truncate text-sm'>{tag.name !== tag.slug ? tag.name : ''}</span>
        <span className='text-right text-sm tabular-nums'>{usage}</span>
        <div className='text-right'>
          {!open && (
            <button
              type='button'
              aria-label={`「${tag.slug}」を編集`}
              onClick={onOpen}
              className='text-sm text-zinc-500 hover:underline dark:text-zinc-400'>
              編集
            </button>
          )}
        </div>
      </div>
      {open && <TagEditor tag={tag} usage={usage} slugs={slugs} onClose={onClose} />}
    </li>
  );
}

// The open row: both names as fields under one 保存, and 削除 set apart on the left. What a
// changed identifier does to the posts is said under its field before anything is sent, and the
// button says merge when that is what it will do.
function TagEditor({
  tag,
  usage,
  slugs,
  onClose,
}: {
  tag: Tag;
  usage: number;
  slugs: string[];
  onClose: () => void;
}) {
  const [state, update, saving] = useActionState(async (prev: TagFormState, formData: FormData) => {
    const next = await updateTagAction(prev, formData);
    if (next.at) onClose();
    return next;
  }, initialState);
  const [deleteState, remove, removing] = useActionState(deleteTagAction, initialState);
  const [to, setTo] = useState(tag.slug);
  const [name, setName] = useState(tag.name);
  const [confirming, setConfirming] = useState(false);
  const formId = useId();
  const slugFieldId = useId();
  const nameFieldId = useId();

  const moving = normalizeTagName(to).toLowerCase() !== tag.slug;
  const problem = moving ? tagSlugProblem(to) : null;
  const target = tagSlug(to);
  const merging = moving && slugs.includes(target);
  const unchanged = !moving && normalizeTagName(name) === tag.name;
  const posts = `${usage} 件の記事`;

  return (
    <div className='mt-3 rounded border border-zinc-200 p-4 dark:border-zinc-800'>
      {/* The delete form below cannot sit inside this one — a form nested in a form is dropped
          by the parser — so 保存, placed beside キャンセル down there, names this form by id. */}
      <form id={formId} action={update} className='grid gap-4 sm:grid-cols-2'>
        <input type='hidden' name='slug' value={tag.slug} />
        <div>
          <label htmlFor={slugFieldId} className='mb-1 block text-xs font-bold'>
            識別子
          </label>
          <input
            id={slugFieldId}
            name='to'
            maxLength={TAG_NAME_MAX_LENGTH}
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className={inputClass}
          />
          {/* Only what a change will do that the author could not take for granted — the posts
              following the identifier they already expect; the URL moving, they may not. What the
              field is, the page's own first line says. */}
          {moving && (
            <p className='mt-1 text-xs text-zinc-500 dark:text-zinc-400'>
              {merging
                ? `${target} に統合され、このタグは削除されます。`
                : `URL が /tags/${target} に変わります。`}
            </p>
          )}
        </div>
        <div>
          <label htmlFor={nameFieldId} className='mb-1 block text-xs font-bold'>
            表示名
          </label>
          <input
            id={nameFieldId}
            name='name'
            maxLength={TAG_NAME_MAX_LENGTH}
            value={name}
            disabled={merging}
            onChange={(event) => setName(event.target.value)}
            className={`${inputClass} disabled:opacity-50`}
          />
          {merging && (
            <p className='mt-1 text-xs text-zinc-500 dark:text-zinc-400'>
              統合先の表示名を使います。
            </p>
          )}
        </div>
      </form>
      <ErrorLine message={problem ?? state.error ?? deleteState.error} />
      <div className='mt-4 flex flex-wrap items-center justify-between gap-3'>
        <form action={remove} className='flex items-center gap-3'>
          <input type='hidden' name='slug' value={tag.slug} />
          {usage > 0 && !confirming ? (
            <button
              type='button'
              onClick={() => setConfirming(true)}
              className='text-sm text-red-600 hover:underline dark:text-red-400'>
              削除
            </button>
          ) : (
            <>
              <button
                type='submit'
                disabled={removing}
                className='text-sm text-red-600 hover:underline disabled:opacity-50 dark:text-red-400'>
                {usage > 0 ? `${posts}から外して削除` : '削除'}
              </button>
              {confirming && (
                <button
                  type='button'
                  onClick={() => setConfirming(false)}
                  className='text-sm text-zinc-500 hover:underline dark:text-zinc-400'>
                  やめる
                </button>
              )}
            </>
          )}
        </form>
        <div className='flex gap-2'>
          <button type='button' onClick={onClose} className={secondaryButtonClass}>
            キャンセル
          </button>
          <button
            type='submit'
            form={formId}
            disabled={saving || unchanged || problem !== null || target === ''}
            className={primaryButtonClass}>
            {merging ? '統合して保存' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
