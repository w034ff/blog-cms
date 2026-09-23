'use client';

import { useActionState, useId, useState } from 'react';
import {
  changeTagSlugAction,
  createTagAction,
  deleteTagAction,
  renameTagAction,
  type TagFormState,
} from '@/app/actions/tags';
import { TAG_NAME_MAX_LENGTH, tagSlug, tagSlugProblem } from '@/lib/content';
import type { Tag } from '@/lib/types';

const inputClass =
  'min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-3 py-1.5 text-sm focus:ring-2 focus:ring-zinc-400 focus:outline-none dark:border-zinc-700';
const buttonClass =
  'shrink-0 rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800';
const linkButtonClass = 'shrink-0 text-sm hover:underline disabled:opacity-50';
const fieldLabelClass = 'text-xs text-zinc-500 dark:text-zinc-400';

const initialState: TagFormState = {};

function ErrorLine({ message }: { message: string | undefined | null }) {
  if (!message) return null;
  return (
    <p role='alert' className='mt-1 text-xs text-red-600 dark:text-red-400'>
      {message}
    </p>
  );
}

// A new tag is typed as its identifier, the same as in the editor; its display name starts out
// the same and is changed in its row afterwards.
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
    <form action={action}>
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
          className={buttonClass}>
          追加
        </button>
      </div>
      <ErrorLine message={problem ?? state.error} />
    </form>
  );
}

// Keyed by slug and name (page.tsx), so a saved rename, or a changed identifier, remounts the row.
//
// One tag, as two labelled lines: 表示名, the name readers see, editable in place; and 識別子, what
// the editor takes and the URL uses, changed only through its own 変更 — which rewrites every post
// holding it, or merges it into the tag it names when that already exists. The count and 削除 sit
// in fixed-width columns so every name field is the same width down the list.
export function TagRow({
  tag,
  usage,
  slugs,
}: {
  tag: Tag;
  usage: number;
  // Every identifier in the dictionary, to tell a change from a merge before it is sent.
  slugs: string[];
}) {
  const [renameState, rename, renaming] = useActionState(renameTagAction, initialState);
  const [slugState, changeSlug, changingSlug] = useActionState(changeTagSlugAction, initialState);
  const [deleteState, remove, removing] = useActionState(deleteTagAction, initialState);
  const [name, setName] = useState(tag.name);
  const [editingSlug, setEditingSlug] = useState(false);
  const [to, setTo] = useState(tag.slug);
  const [confirming, setConfirming] = useState(false);
  const slugId = useId();

  const problem = editingSlug ? tagSlugProblem(to) : null;
  const target = tagSlug(to);
  const merging = target !== tag.slug && slugs.includes(target);
  const posts = `${usage} 件の記事`;

  return (
    <li className='py-3'>
      <div className='grid grid-cols-[auto_minmax(0,1fr)_3rem_2.5rem] items-center gap-x-3 gap-y-2'>
        <span className={fieldLabelClass}>表示名</span>
        <form action={rename} className='flex min-w-0 gap-2'>
          <input type='hidden' name='slug' value={tag.slug} />
          <input
            name='name'
            aria-label={`「${tag.slug}」の表示名`}
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
        <span className='text-right text-sm text-zinc-500 dark:text-zinc-400'>{usage} 件</span>
        <div className='text-right'>
          {usage > 0 ? (
            <button
              type='button'
              aria-expanded={confirming}
              onClick={() => setConfirming(true)}
              className='text-sm text-red-600 hover:underline'>
              削除
            </button>
          ) : (
            <form action={remove}>
              <input type='hidden' name='slug' value={tag.slug} />
              <button
                type='submit'
                disabled={removing}
                className='text-sm text-red-600 hover:underline disabled:opacity-50'>
                削除
              </button>
            </form>
          )}
        </div>

        <span id={slugId} className={fieldLabelClass}>
          識別子
        </span>
        {editingSlug ? (
          <form
            action={changeSlug}
            className='col-span-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2'>
            <input type='hidden' name='slug' value={tag.slug} />
            <input
              name='to'
              aria-label={`「${tag.slug}」の新しい識別子`}
              maxLength={TAG_NAME_MAX_LENGTH}
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className={`${inputClass} basis-40`}
            />
            <button
              type='submit'
              disabled={changingSlug || problem !== null || target === '' || target === tag.slug}
              className={`${linkButtonClass} text-red-600`}>
              {merging ? `「${target}」に統合（${posts}）` : `識別子を変更（${posts}）`}
            </button>
            <button
              type='button'
              onClick={() => {
                setEditingSlug(false);
                setTo(tag.slug);
              }}
              className={`${linkButtonClass} text-zinc-600 dark:text-zinc-400`}>
              やめる
            </button>
          </form>
        ) : (
          <div className='col-span-3 flex min-w-0 items-center gap-3'>
            <span className='truncate text-sm'>{tag.slug}</span>
            <button
              type='button'
              aria-label={`「${tag.slug}」の識別子を変更`}
              onClick={() => setEditingSlug(true)}
              className={`${linkButtonClass} text-zinc-600 dark:text-zinc-400`}>
              変更
            </button>
          </div>
        )}
      </div>

      {editingSlug && (
        <p className='mt-1 text-xs text-zinc-500 dark:text-zinc-400'>
          {merging
            ? `このタグの記事は「${target}」に付け替わり、このタグは消えます。`
            : 'このタグの記事はすべて新しい識別子に付け替わります。'}
          今のタグページの URL は使えなくなります。
        </p>
      )}
      {confirming && (
        <form action={remove} className='mt-2 flex items-center justify-end gap-4 text-sm'>
          <input type='hidden' name='slug' value={tag.slug} />
          <button
            type='submit'
            disabled={removing}
            className='text-red-600 hover:underline disabled:opacity-50'>
            {posts}から外して削除
          </button>
          <button
            type='button'
            onClick={() => setConfirming(false)}
            className='text-zinc-600 hover:underline dark:text-zinc-400'>
            やめる
          </button>
        </form>
      )}
      <ErrorLine message={renameState.error} />
      <ErrorLine message={problem ?? slugState.error} />
      <ErrorLine message={deleteState.error} />
    </li>
  );
}
