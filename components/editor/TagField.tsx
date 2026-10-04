'use client';

import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { MAX_TAGS, normalizeTagName, tagSearchKey, tagSlug, tagSlugProblem } from '@/lib/content';
import type { DictionaryTag, Tag } from '@/lib/types';
import { CloseIcon } from './svg/CloseIcon';

// タグ as chips picked from the dictionary (docs/editor-requirements.md §12.33). Typing filters the
// dictionary; a name it does not have is offered as its own last row, 「…」を新しいタグとして追加,
// so a new tag is always a separate, deliberate choice rather than what Enter does to a typo.
//
// The form reads one field, the hidden `tags` input, as comma-separated slugs — the text box has
// no `name`, so what is being typed never reaches autosave or publish.
//
// The list opens on typing, not on focus: a click into the box is also how the author gets back
// into the drawer, and Escape there has to close the drawer, not a list they never asked for.

const MAX_OPTIONS = 8;

type Option = { kind: 'existing'; tag: DictionaryTag } | { kind: 'create'; name: string };

// Existing tags are found by `tagSearchKey`, so typing `Next.js` still offers `nextjs`: the text
// with symbols cannot become a tag of its own, and the tag it was reaching for is the answer.
function matches(
  dictionary: readonly DictionaryTag[],
  selected: readonly string[],
  query: string,
): Option[] {
  const name = normalizeTagName(query);
  const needle = tagSearchKey(name);
  if (needle === '') return [];
  const keyOf = (tag: Tag) => tagSearchKey(tag.name);
  // An alias finds its tag, and the row shows the tag itself: that is what the chip will say.
  const hit = (tag: DictionaryTag) =>
    keyOf(tag).includes(needle) ||
    tag.slug.includes(needle) ||
    tag.aliases.some((alias) => alias.includes(needle));
  const starts = (tag: DictionaryTag) =>
    keyOf(tag).startsWith(needle) ||
    tag.slug.startsWith(needle) ||
    tag.aliases.some((alias) => alias.startsWith(needle));
  const found = dictionary
    .filter((tag) => !selected.includes(tag.slug))
    .filter(hit)
    .map((tag): Option => ({ kind: 'existing', tag }))
    .sort((a, b) =>
      a.kind === 'existing' && b.kind === 'existing'
        ? Number(!starts(a.tag)) - Number(!starts(b.tag)) || a.tag.slug.localeCompare(b.tag.slug)
        : 0,
    )
    .slice(0, MAX_OPTIONS);
  // Offered for any text that can be a tag unless the dictionary already has it by identifier,
  // alias or name (lib/tags.ts `createTag` would return that one). Still offered when the text is a
  // prefix of an existing tag, or `go` beside `golang` could never be made; it is quieted instead.
  const slug = tagSlug(name);
  const exists = dictionary.some(
    (tag) => tag.slug === slug || tag.aliases.includes(slug) || tag.name === name,
  );
  return slug === '' || exists ? found : [...found, { kind: 'create', name }];
}

export function TagField({
  value,
  onChange,
  dictionary: initialDictionary,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  dictionary: DictionaryTag[];
}) {
  const labelId = useId();
  const listId = useId();
  const [dictionary, setDictionary] = useState(initialDictionary);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // At the limit, typing a sixth tag shows the limit in red instead of opening the list, rather
  // than a permanent counter for a limit most posts never reach.
  const overLimit = value.length >= MAX_TAGS && normalizeTagName(query) !== '';
  const options = useMemo(
    () => (overLimit ? [] : matches(dictionary, value, query)),
    [overLimit, dictionary, value, query],
  );
  const expanded = open && options.length > 0;
  // Symbols and length are said as soon as they are typed, above the list that still offers what
  // the text was probably reaching for (`matches`).
  const problem = overLimit ? null : tagSlugProblem(query);
  const message = overLimit ? `タグは ${MAX_TAGS} つまで設定できます。` : (problem ?? error);
  const messageId = useId();
  const activeIndex = Math.min(active, options.length - 1);

  function add(slug: string): void {
    if (!value.includes(slug)) onChange([...value, slug]);
    setQuery('');
    setOpen(false);
    setActive(0);
  }

  async function choose(option: Option): Promise<void> {
    setError('');
    if (option.kind === 'existing') {
      add(option.tag.slug);
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: option.name }),
      });
      const body: unknown = await response.json().catch(() => null);
      const tag = readTag(body);
      if (!response.ok || tag === null) {
        setError(readError(body) ?? 'タグを追加できませんでした。');
        return;
      }
      setDictionary((current) =>
        current.some((known) => known.slug === tag.slug)
          ? current
          : [...current, { ...tag, aliases: [] }],
      );
      add(tag.slug);
    } catch {
      setError('タグを追加できませんでした。');
    } finally {
      setCreating(false);
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    // An Enter that confirms an IME conversion is the composition's, not a choice: without this,
    // confirming 設計 would add whatever the half-typed reading matched.
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (options.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setOpen(true);
      setActive((activeIndex + step + options.length) % options.length);
    } else if (event.key === 'Enter') {
      // The drawer's own handler cancels implicit submission for every input; this only decides.
      if (expanded && !creating) void choose(options[activeIndex]);
    } else if (event.key === 'Escape' && expanded) {
      // The list's Escape, not the drawer's. Under the App Router `document` is React's root, so
      // useDismiss's listener shares the node and only `stopImmediatePropagation` stops it
      // (docs/editor-pitfalls.md §15.3).
      event.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    } else if (event.key === 'Backspace' && query === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <div className='text-sm'>
      <span id={labelId} className='mb-1 block font-bold'>
        タグ
      </span>
      {/* Above the box, not under it: the list opens under it and would push a message there out
          of sight. */}
      {message !== '' && (
        <p id={messageId} role='alert' className='mb-1 text-xs text-red-600 dark:text-red-400'>
          {message}
        </p>
      )}
      <input type='hidden' name='tags' value={value.join(',')} />
      <div className='flex flex-wrap items-center gap-1.5 rounded-box border border-zinc-300 px-2 py-1.5 focus-within:ring-2 focus-within:ring-zinc-400 dark:border-zinc-700'>
        {/* Chips are identifiers — what was typed and what is stored. The display name readers see
            is /admin/tags' to set, and shows beside the identifier in the list below. */}
        {value.map((slug) => (
          <span
            key={slug}
            className='inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pr-1 pl-2.5 text-xs dark:bg-zinc-800'>
            {slug}
            <button
              type='button'
              aria-label={`「${slug}」を外す`}
              onClick={() => onChange(value.filter((kept) => kept !== slug))}
              className='rounded-full p-0.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100'>
              <CloseIcon />
            </button>
          </span>
        ))}
        <input
          role='combobox'
          aria-labelledby={labelId}
          aria-autocomplete='list'
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded ? optionId(activeIndex) : undefined}
          value={query}
          aria-invalid={overLimit || problem !== null || undefined}
          aria-describedby={message !== '' ? messageId : undefined}
          // Only while there are no chips: after one, what is left of the line is too narrow to
          // hold it whole.
          placeholder={value.length === 0 ? `タグを ${MAX_TAGS} つまで入力` : ''}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
            setError('');
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          className='min-w-24 flex-1 bg-transparent py-1 text-sm outline-none'
        />
      </div>
      <ul
        id={listId}
        role='listbox'
        aria-labelledby={labelId}
        hidden={!expanded}
        className='mt-1 max-h-60 overflow-y-auto rounded-box border border-zinc-300 py-1 dark:border-zinc-700'>
        {options.map((option, index) => (
          <li
            key={option.kind === 'existing' ? option.tag.slug : `create:${option.name}`}
            id={optionId(index)}
            role='option'
            aria-selected={index === activeIndex}
            aria-disabled={creating || undefined}
            // Focus stays in the text box: a press here would otherwise blur it, and the blur
            // closes the list before the click lands. The choice itself waits for the click.
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => {
              if (!creating) void choose(option);
            }}
            // The add row is set apart and quieter, since it appears under almost every keystroke;
            // it is still an option reached by the arrows.
            className={`flex min-w-0 cursor-pointer items-baseline gap-3 px-3 ${
              option.kind === 'create'
                ? `py-1.5 text-xs text-zinc-500 dark:text-zinc-400 ${index > 0 ? 'mt-1 border-t border-zinc-200 dark:border-zinc-700' : ''}`
                : 'py-1.5'
            } ${index === activeIndex ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}>
            {option.kind === 'existing' ? (
              <ExistingOption tag={option.tag} />
            ) : (
              `「${option.name}」を新しいタグとして追加`
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// An existing tag's row: its identifier — what the author types and what the chip will say — and,
// only when /admin/tags gave it a different one, the display name readers see, quieter and cut
// first when the row is short of width. `title` carries both whole.
function ExistingOption({ tag }: { tag: Tag }) {
  const shown = tag.name !== tag.slug;
  return (
    <>
      <span className='min-w-0 shrink-0 truncate' title={shown ? undefined : tag.slug}>
        {tag.slug}
      </span>
      {shown && (
        <span
          className='min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400'
          title={`${tag.slug}（表示名: ${tag.name}）`}>
          {tag.name}
        </span>
      )}
    </>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readTag(body: unknown): Tag | null {
  if (!isRecord(body) || !isRecord(body.tag)) return null;
  const { slug, name } = body.tag;
  return typeof slug === 'string' && typeof name === 'string' ? { slug, name } : null;
}

function readError(body: unknown): string | null {
  return isRecord(body) && typeof body.error === 'string' ? body.error : null;
}
