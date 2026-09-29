'use client';

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
import { EditorTooltip } from '@/components/editor/EditorTooltip';

const inputClass =
  'w-full min-w-0 rounded-xs border border-zinc-300 bg-surface px-3 py-1.5 text-sm focus:ring-2 focus:ring-zinc-400 focus:outline-none dark:border-zinc-700';
const secondaryButtonClass = 'button-secondary shrink-0 px-3 py-1.5 text-sm disabled:opacity-50';
const primaryButtonClass = 'button-primary shrink-0 px-3 py-1.5 text-sm disabled:opacity-40';
// One grey (`zinc-600`, `zinc-400` in dark) for the chrome — headings, each row's 編集 — and the
// body colour for the data, so the data reads first. One grid for the header and every row, so the
// columns line up.
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

// One field both searches and adds. It narrows the table the way the editor's field finds tags
// (`tagSearchKey`: identifier, display name or alias). 追加 opens only when no tag is that word, so a
// new tag is made with its likely duplicates in view; the text stays, leaving the new row on screen.
//
// Read-only rows, one open for editing at a time. Sorted by identifier, or by 記事 count: most first,
// then least first, which brings up the tags no post uses.
export function TagDirectory({
  tags,
  usage,
}: {
  tags: DictionaryTag[];
  // Posts per identifier, drafts and pending edits included (lib/tags.ts `tagUsage`).
  usage: Record<string, number>;
}) {
  const [state, create, creating] = useActionState(createTagAction, initialState);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<'slug' | 'countDesc' | 'countAsc'>('slug');

  // Every word that names a tag — identifiers and aliases — to that tag's identifier, so an open row
  // can tell a change from a merge before anything is sent, and 追加 can tell a new word from a known one.
  const owners: Record<string, string> = Object.fromEntries(
    tags.flatMap((tag) => [tag.slug, ...tag.aliases].map((word) => [word, tag.slug])),
  );
  const needle = tagSearchKey(query);
  const shown = tags
    .filter(
      (tag) =>
        needle === '' ||
        tag.slug.includes(needle) ||
        tagSearchKey(tag.name).includes(needle) ||
        tag.aliases.some((alias) => alias.includes(needle)),
    )
    .sort((a, b) => {
      const byCount = (usage[b.slug] ?? 0) - (usage[a.slug] ?? 0);
      const bySlug = a.slug.localeCompare(b.slug);
      if (sort === 'countDesc') return byCount || bySlug;
      if (sort === 'countAsc') return -byCount || bySlug;
      return bySlug;
    });
  const byCount = sort !== 'slug';
  const problem = tagSlugProblem(query);
  const word = tagSlug(query);
  const known =
    word !== '' &&
    (owners[word] !== undefined ||
      tags.some((tag) => normalizeTagName(tag.name) === normalizeTagName(query)));
  const headingButton = (active: boolean) =>
    `hover:underline ${active ? 'font-bold text-zinc-900 dark:text-zinc-100' : ''}`;
  // A faint ↕ on each inactive heading: bold alone left a heading that sorts looking like one that
  // does not. The active one shows a direction only where a press reverses it — 識別子 is A→Z
  // alone, so it gets none. Out of the name — aria-pressed and 記事's label say the order.
  const sortArrow = (arrow: string | null) => (
    <span
      aria-hidden
      className={arrow === null ? 'font-normal text-zinc-300 dark:text-zinc-600' : undefined}>
      {' '}
      {arrow ?? '↕'}
    </span>
  );

  return (
    <div>
      <form action={create} className='max-w-md'>
        <div className='flex gap-2'>
          <input
            name='name'
            aria-label='タグを検索・追加'
            placeholder='タグを検索・追加'
            maxLength={TAG_NAME_MAX_LENGTH}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={inputClass}
          />
          <button
            type='submit'
            disabled={creating || word === '' || known || problem !== null}
            className={secondaryButtonClass}>
            追加
          </button>
        </div>
        {/* Why 追加 is shut is said only when nothing matched — while the text finds tags it is a
            search, and `C#` typed to find `csharp` is not a mistake. */}
        <ErrorLine message={(shown.length === 0 ? problem : null) ?? state.error} />
      </form>

      <div className='mt-8'>
        <div
          className={`${columnsClass} border-b border-zinc-200 pb-2 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400`}>
          {/* The tooltip says what a press does; the order now is the arrow's and aria-label's job.
              A sibling of the button, not its child, so the button's text stays its name. */}
          <span className='group/tt relative justify-self-start'>
            <button
              type='button'
              aria-pressed={sort === 'slug'}
              onClick={() => setSort('slug')}
              className={headingButton(sort === 'slug')}>
              識別子{sort !== 'slug' && sortArrow(null)}
            </button>
            {/* None when active: a press changes nothing. */}
            {sort !== 'slug' && <EditorTooltip label='A→Z 順に並べる' />}
          </span>
          <span>表示名</span>
          {/* First press: most first. Each press after: the other way. */}
          <span className='group/tt relative justify-self-end'>
            <button
              type='button'
              aria-pressed={byCount}
              aria-label={
                sort === 'countAsc'
                  ? '記事（少ない順）'
                  : sort === 'countDesc'
                    ? '記事（多い順）'
                    : '記事'
              }
              onClick={() => setSort(sort === 'countDesc' ? 'countAsc' : 'countDesc')}
              className={headingButton(byCount)}>
              記事{sortArrow(sort === 'countDesc' ? '↓' : sort === 'countAsc' ? '↑' : null)}
            </button>
            <EditorTooltip label={sort === 'countDesc' ? '少ない順に並べる' : '多い順に並べる'} />
          </span>
          <span />
        </div>
        {shown.length === 0 ? (
          <p className='py-3 text-sm text-zinc-600 dark:text-zinc-400'>
            {tags.length === 0 ? 'タグはまだありません。' : '当てはまるタグはありません。'}
          </p>
        ) : (
          <ul className='divide-y divide-zinc-200 dark:divide-zinc-800'>
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
    <li className='py-3'>
      <div className={columnsClass}>
        <span className='truncate text-sm'>
          <span className='font-medium'>{tag.slug}</span>
          {tag.aliases.length > 0 && (
            <span className='text-zinc-600 dark:text-zinc-400'>
              {' '}
              （別名 {tag.aliases.join('、')}）
            </span>
          )}
        </span>
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
        別名
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
                  aria-label={`別名「${word}」を外す`}
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
