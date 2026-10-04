'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';
import {
  addAliasAction,
  createTagAction,
  removeAliasAction,
  deleteTagAction,
  updateTagAction,
  type TagFormState,
} from '@/app/actions/tags';
import {
  TAG_NAME_MAX_LENGTH,
  normalizeTagName,
  tagSearchKey,
  tagSlug,
  tagSlugProblem,
} from '@/lib/content';
import type { DictionaryTag } from '@/lib/types';
import {
  countByUse,
  matchesUse,
  sortTags,
  tagListHref,
  type TagListParams,
  type TagSort,
  type TagUse,
} from '@/lib/admin-tag-list';
import { OptionMenu } from '../OptionMenu';

const inputClass =
  'w-full min-w-0 rounded-box border border-zinc-300 bg-surface px-3 py-1.5 text-sm focus:ring-2 focus:ring-zinc-400 focus:outline-none dark:border-zinc-700';
const secondaryButtonClass = 'button-secondary shrink-0 px-3 py-1.5 text-sm disabled:opacity-50';
const primaryButtonClass = 'button-primary shrink-0 px-3 py-1.5 text-sm disabled:opacity-40';
// One grey (`zinc-600`, `zinc-400` in dark) for the chrome — each row's 編集, a count of 0 — and the
// body colour for the data, so the data reads first. One grid for the whole list, which each row
// and its cells take as a subgrid: the count and 編集 columns are as wide as their widest cell, so
// 1,000 記事 widens its column instead of running into 編集, and the columns line up with no
// heading row over them.
const listClass = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-x-4';
const rowClass = 'col-span-full grid grid-cols-subgrid';

const USE_TABS: { use: TagUse; label: string }[] = [
  { use: 'all', label: 'すべて' },
  { use: 'used', label: '使用中' },
  { use: 'unused', label: '未使用' },
];

const SORT_OPTIONS: { sort: TagSort; label: string }[] = [
  { sort: 'slug', label: '識別子順' },
  { sort: 'most', label: '記事の多い順' },
  { sort: 'least', label: '記事の少ない順' },
];

const initialState: TagFormState = {};

function ErrorLine({ message }: { message: string | undefined | null }) {
  if (!message) return null;
  return (
    <p role='alert' className='mt-2 text-xs text-red-600 dark:text-red-400'>
      {message}
    </p>
  );
}

// One field both searches and adds. It narrows the table the way the editor's field finds tags
// (`tagSearchKey`: identifier, display name or alias). Adding is a row at the head of the sheet,
// 「…」を新しいタグとして追加 as the editor's tag field offers it, there only when no tag is that word:
// a 追加 button beside the field sat disabled nearly all the time. So a new tag is made with its
// likely duplicates in view below it; the text stays, leaving the new row on screen.
//
// 記事一覧's frame (ListControls.tsx): the field and the tabs over the sheet, the rows alone on it.
// The tabs split the dictionary by use and count what the search leaves, so a tab's number is what
// clicking it shows. Tab and sort are links (lib/admin-tag-list.ts); the field's text is this
// component's state, which a same-page navigation keeps. Read-only rows, one open for editing at a
// time.
export function TagDirectory({
  tags,
  usage,
  params,
}: {
  tags: DictionaryTag[];
  // Posts per identifier, drafts and pending edits included (lib/tags.ts `tagUsage`).
  usage: Record<string, number>;
  params: TagListParams;
}) {
  const [state, create, creating] = useActionState(createTagAction, initialState);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  // Every word that names a tag — identifiers and aliases — to that tag's identifier, so an open row
  // can tell a change from a merge before anything is sent, and 追加 can tell a new word from a known one.
  const owners: Record<string, string> = Object.fromEntries(
    tags.flatMap((tag) => [tag.slug, ...tag.aliases].map((word) => [word, tag.slug])),
  );
  const needle = tagSearchKey(query);
  const found = tags.filter(
    (tag) =>
      needle === '' ||
      tag.slug.includes(needle) ||
      tagSearchKey(tag.name).includes(needle) ||
      tag.aliases.some((alias) => alias.includes(needle)),
  );
  const counts = countByUse(found, usage);
  const shown = sortTags(
    found.filter((tag) => matchesUse(usage[tag.slug] ?? 0, params.use)),
    usage,
    params.sort,
  );
  const problem = tagSlugProblem(query);
  const word = tagSlug(query);
  const known =
    word !== '' &&
    (owners[word] !== undefined ||
      tags.some((tag) => normalizeTagName(tag.name) === normalizeTagName(query)));
  const addable = word !== '' && !known && problem === null;
  const formId = useId();

  return (
    <div>
      {/* Enter in the field submits only what the add row would. */}
      <form
        id={formId}
        action={create}
        onSubmit={(event) => {
          if (!addable || creating) event.preventDefault();
        }}
        className='mb-3'>
        <div className='relative'>
          <svg
            aria-hidden='true'
            viewBox='0 0 16 16'
            className='pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500'>
            <circle cx='7' cy='7' r='4.5' fill='none' stroke='currentColor' strokeWidth='1.5' />
            <path d='M10.5 10.5L14 14' stroke='currentColor' strokeWidth='1.5' />
          </svg>
          <input
            name='name'
            aria-label='タグを検索・追加'
            placeholder='タグを検索・追加'
            maxLength={TAG_NAME_MAX_LENGTH}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className='w-full rounded-box border border-zinc-300 bg-surface py-2 pr-3 pl-9 text-base focus:ring-2 focus:ring-zinc-400 focus:outline-none dark:border-zinc-700'
          />
        </div>
        {/* Why no add row is offered is said only when nothing matched — while the text finds tags it is a
            search, and `C#` typed to find `csharp` is not a mistake. */}
        <ErrorLine message={(found.length === 0 ? problem : null) ?? state.error} />
      </form>

      <div className='mb-3 flex flex-wrap-reverse items-end justify-between gap-x-6 gap-y-2 border-b border-zinc-300 dark:border-zinc-700'>
        {/* Scrolls sideways rather than run off a narrow phone when the counts grow; no scrollbar,
            which would sit on the underline. */}
        <nav
          aria-label='使われ方'
          className='-mb-px flex max-w-full gap-6 overflow-x-auto [scrollbar-width:none]'>
          {USE_TABS.map(({ use, label }) => {
            const current = params.use === use;
            return (
              <Link
                key={use}
                href={tagListHref(params, { use })}
                aria-current={current ? 'page' : undefined}
                className={`border-b-3 py-2 text-base whitespace-nowrap ${
                  current
                    ? 'border-(--accent) font-semibold text-zinc-900 dark:text-zinc-50'
                    : 'border-transparent text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50'
                }`}>
                {label}
                <span className='ml-1.5 text-xs font-normal text-zinc-500'>
                  {counts[use].toLocaleString('en-US')}
                </span>
              </Link>
            );
          })}
        </nav>
        <div className='pb-2'>
          <OptionMenu
            label='並び替え'
            options={SORT_OPTIONS.map(({ sort, label }) => ({
              label,
              href: tagListHref(params, { sort }),
              current: params.sort === sort,
            }))}
          />
        </div>
      </div>

      {/* On a white sheet, as 記事一覧's rows are. */}
      <div className='rounded-panel border border-zinc-200 bg-surface px-4 dark:border-zinc-800'>
        {addable && (
          // In the list's place, not the form's: `form` ties it to the field's form.
          <button
            type='submit'
            form={formId}
            disabled={creating}
            className={`flex w-full items-center gap-2 py-3 text-left text-sm text-zinc-700 hover:text-zinc-950 disabled:opacity-50 dark:text-zinc-300 dark:hover:text-zinc-50 ${shown.length > 0 ? 'border-b border-zinc-200 dark:border-zinc-800' : ''}`}>
            <span
              aria-hidden='true'
              className='inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-chip bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'>
              ＋
            </span>
            <span className='min-w-0 truncate'>
              「<b className='font-semibold'>{query.trim()}</b>」を新しいタグとして追加
            </span>
          </button>
        )}
        {shown.length === 0 ? (
          addable ? null : (
            <p className='py-3 text-sm text-zinc-600 dark:text-zinc-400'>
              {tags.length === 0 ? 'タグはまだありません。' : '当てはまるタグはありません。'}
            </p>
          )
        ) : (
          <ul className={`${listClass} divide-y divide-zinc-200 dark:divide-zinc-800`}>
            {shown.map((tag) => (
              <TagRow
                // Keyed by both, so a saved change remounts the row with the server's values.
                key={`${tag.slug}:${tag.name}`}
                tag={tag}
                usage={usage[tag.slug] ?? 0}
                owners={owners}
                open={open === tag.slug}
                onOpen={() => setOpen(tag.slug)}
                onClose={() => setOpen(null)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TagRow({
  tag,
  usage,
  owners,
  open,
  onOpen,
  onClose,
}: {
  tag: DictionaryTag;
  usage: number;
  owners: Record<string, string>;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <li className={`${rowClass} py-3`}>
      <div className={`${rowClass} items-center`}>
        <span className='truncate text-sm'>
          <span className='font-medium'>{tag.slug}</span>
          {/* The エイリアス, in brackets with no word for them: the open row's field and the help
              dialog name them, and the word would take its width from the identifier. */}
          {tag.aliases.length > 0 && (
            <span className='text-zinc-600 dark:text-zinc-400'>（{tag.aliases.join('、')}）</span>
          )}
        </span>
        {/* Only a display name that differs is shown: the same word twice is the noise this
            table is meant to be without. */}
        <span className='truncate text-sm'>{tag.name !== tag.slug ? tag.name : ''}</span>
        {/* With its unit: no heading row says what the number counts. */}
        <span
          className={`text-right text-sm whitespace-nowrap tabular-nums ${usage === 0 ? 'text-zinc-500' : ''}`}>
          {usage.toLocaleString('en-US')} 記事
        </span>
        <div className='text-right'>
          {!open && (
            <button
              type='button'
              aria-label={`「${tag.slug}」を編集`}
              onClick={onOpen}
              className='text-sm text-zinc-600 hover:underline dark:text-zinc-400'>
              編集
            </button>
          )}
        </div>
      </div>
      {open && <TagEditor tag={tag} usage={usage} owners={owners} onClose={onClose} />}
    </li>
  );
}

// The open row: both names as fields under one 保存, and 削除 set apart on the left. What a
// changed identifier does to the posts is said under its field before anything is sent, and the
// button says merge when that is what it will do.
function TagEditor({
  tag,
  usage,
  owners,
  onClose,
}: {
  tag: DictionaryTag;
  usage: number;
  owners: Record<string, string>;
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
  // The tag the new identifier already names, if any — by its own identifier or as an alias. This
  // tag's own alias is a swap, not a merge (lib/tags.ts `changeTagSlug`).
  const owner = moving ? owners[target] : undefined;
  const merging = owner !== undefined && owner !== tag.slug;
  const unchanged = !moving && normalizeTagName(name) === tag.name;
  const posts = `${usage} 件の記事`;

  return (
    <div className='col-span-full mt-3 rounded-box border border-zinc-200 p-4 dark:border-zinc-800'>
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
          {/* Only what the author could not take for granted: the URL moving, or the merge. */}
          {moving && (
            <p className='mt-1 text-xs text-zinc-600 dark:text-zinc-400'>
              {merging
                ? `${owner} に統合され、このタグは削除されます。`
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
            <p className='mt-1 text-xs text-zinc-600 dark:text-zinc-400'>
              統合先の表示名を使います。
            </p>
          )}
        </div>
      </form>
      <AliasEditor tag={tag} />
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
                  className='text-sm text-zinc-600 hover:underline dark:text-zinc-400'>
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

// A tag's aliases: other words that stand for it (lib/tags.ts), each taken off on its own, and one
// field to add another. Separate forms from the fields above, which a form may not contain.
function AliasEditor({ tag }: { tag: DictionaryTag }) {
  const [addState, add, adding] = useActionState(addAliasAction, initialState);
  const [removeState, remove, removing] = useActionState(removeAliasAction, initialState);
  const [alias, setAlias] = useState('');
  const [clearedAt, setClearedAt] = useState(addState.at);
  if (addState.at !== clearedAt) {
    setClearedAt(addState.at);
    setAlias('');
  }
  const fieldId = useId();
  const problem = tagSlugProblem(alias);
  return (
    <div className='mt-4'>
      <label htmlFor={fieldId} className='mb-1 block text-xs font-bold'>
        エイリアス
      </label>
      {tag.aliases.length > 0 && (
        <ul className='mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm'>
          {tag.aliases.map((word) => (
            <li key={word}>
              <form action={remove} className='flex items-center gap-2'>
                <input type='hidden' name='alias' value={word} />
                {word}
                <button
                  type='submit'
                  disabled={removing}
                  aria-label={`エイリアス「${word}」を外す`}
                  className='text-xs text-zinc-600 hover:underline disabled:opacity-50 dark:text-zinc-400'>
                  外す
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={add} className='flex max-w-sm gap-2'>
        <input type='hidden' name='slug' value={tag.slug} />
        <input
          id={fieldId}
          name='alias'
          maxLength={TAG_NAME_MAX_LENGTH}
          value={alias}
          onChange={(event) => setAlias(event.target.value)}
          className={inputClass}
        />
        <button
          type='submit'
          disabled={adding || alias.trim() === '' || problem !== null}
          className={secondaryButtonClass}>
          追加
        </button>
      </form>
      <ErrorLine message={problem ?? addState.error ?? removeState.error} />
    </div>
  );
}
