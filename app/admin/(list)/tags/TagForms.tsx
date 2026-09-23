'use client';

import { useActionState, useState } from 'react';
import {
  createTagAction,
  deleteTagAction,
  renameTagAction,
  type TagFormState,
} from '@/app/actions/tags';
import { TAG_NAME_MAX_LENGTH } from '@/lib/content';
import type { Tag } from '@/lib/types';

const inputClass =
  'min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-3 py-1.5 text-sm focus:ring-2 focus:ring-zinc-400 focus:outline-none dark:border-zinc-700';
const buttonClass =
  'shrink-0 rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800';

const initialState: TagFormState = {};

function ErrorLine({ state }: { state: TagFormState }) {
  if (!state.error) return null;
  return (
    <p role='alert' className='mt-1 text-xs text-red-600 dark:text-red-400'>
      {state.error}
    </p>
  );
}

export function NewTagForm() {
  const [state, action, pending] = useActionState(createTagAction, initialState);
  const [name, setName] = useState('');
  // Cleared once per success, and only then: a refused name stays for the author to fix.
  const [clearedAt, setClearedAt] = useState(state.at);
  if (state.at !== clearedAt) {
    setClearedAt(state.at);
    setName('');
  }
  return (
    <form action={action}>
      <div className='flex gap-2'>
        <input
          name='name'
          aria-label='新しいタグの名前'
          placeholder='新しいタグの名前'
          maxLength={TAG_NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
        <button type='submit' disabled={pending || name.trim() === ''} className={buttonClass}>
          追加
        </button>
      </div>
      <ErrorLine state={state} />
    </form>
  );
}

// Keyed by slug and name (page.tsx), so a saved rename remounts the row with the new name.
//
// One tag: its name as an editable field, how many posts carry it, and 削除. A tag in use
// asks once more before it goes, naming the count — deleting takes it off every one of those posts.
export function TagRow({ tag, usage }: { tag: Tag; usage: number }) {
  const [renameState, rename, renaming] = useActionState(renameTagAction, initialState);
  const [deleteState, remove, removing] = useActionState(deleteTagAction, initialState);
  const [name, setName] = useState(tag.name);
  const [confirming, setConfirming] = useState(false);

  // The row's right-hand side is fixed-width — the count and 削除 only — so every name field is
  // the same width down the list. The confirmation used to replace 削除 inline, and its width made
  // the fields ragged; it opens on a line of its own under the row now. No URL: the slug is the
  // tag's name as first typed, and nothing done on this page reads it.
  return (
    <li className='py-3'>
      <div className='flex items-center gap-3'>
        <form action={rename} className='flex min-w-0 flex-1 gap-2'>
          <input type='hidden' name='slug' value={tag.slug} />
          <input
            name='name'
            aria-label={`「${tag.name}」の名前`}
            maxLength={TAG_NAME_MAX_LENGTH}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
          />
          <button
            type='submit'
            disabled={renaming || name.trim() === '' || name === tag.name}
            className={buttonClass}>
            保存
          </button>
        </form>
        <span className='w-12 shrink-0 text-right text-sm text-zinc-500 dark:text-zinc-400'>
          {usage} 件
        </span>
        <form action={remove} className='w-10 shrink-0 text-right'>
          <input type='hidden' name='slug' value={tag.slug} />
          {usage > 0 ? (
            <button
              type='button'
              aria-expanded={confirming}
              onClick={() => setConfirming(true)}
              className='text-sm text-red-600 hover:underline'>
              削除
            </button>
          ) : (
            <button
              type='submit'
              disabled={removing}
              className='text-sm text-red-600 hover:underline disabled:opacity-50'>
              削除
            </button>
          )}
        </form>
      </div>
      {confirming && (
        <form action={remove} className='mt-2 flex items-center justify-end gap-4 text-sm'>
          <input type='hidden' name='slug' value={tag.slug} />
          <button
            type='submit'
            disabled={removing}
            className='text-red-600 hover:underline disabled:opacity-50'>
            {usage} 件の記事から外して削除
          </button>
          <button
            type='button'
            onClick={() => setConfirming(false)}
            className='text-zinc-600 hover:underline dark:text-zinc-400'>
            やめる
          </button>
        </form>
      )}
      <ErrorLine state={renameState} />
      <ErrorLine state={deleteState} />
    </li>
  );
}
