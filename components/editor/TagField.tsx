'use client';

import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { MAX_TAGS, normalizeTagName, tagSlug } from '@/lib/content';
import type { Tag } from '@/lib/types';
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

type Option = { kind: 'existing'; tag: Tag } | { kind: 'create'; name: string };

function matches(dictionary: readonly Tag[], selected: readonly string[], query: string): Option[] {
  const name = normalizeTagName(query);
  if (name === '') return [];
  const needle = name.toLowerCase();
  const slug = tagSlug(name);
  const found = dictionary
    .filter((tag) => !selected.includes(tag.slug))
    .filter(
      (tag) => tag.name.toLowerCase().includes(needle) || (slug !== '' && tag.slug.includes(slug)),
    )
    .sort(
      (a, b) =>
        Number(!a.name.toLowerCase().startsWith(needle)) -
          Number(!b.name.toLowerCase().startsWith(needle)) || a.name.localeCompare(b.name),
    )
    .slice(0, MAX_OPTIONS)
    .map((tag): Option => ({ kind: 'existing', tag }));
  // Offered only when nothing in the dictionary already is this tag, selected or not — the server
  // would answer with that tag anyway (lib/tags.ts `createTag`), and a row promising a new one would
  // be a lie.
  const exists = dictionary.some((tag) => tag.slug === slug || tag.name === name);
  return slug === '' || exists ? found : [...found, { kind: 'create', name }];
}

export function TagField({
  value,
  onChange,
  dictionary: initialDictionary,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  dictionary: Tag[];
}) {
  const labelId = useId();
  const listId = useId();
  const [dictionary, setDictionary] = useState(initialDictionary);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const names = useMemo(() => new Map(dictionary.map((tag) => [tag.slug, tag.name])), [dictionary]);
  // At the limit the box still takes typing, and the first character of a sixth tag is what
  // says so: the list stays shut and the limit shows in red above the box, instead of a hint
  // that sits there the whole time (a counter, a placeholder) for a limit most posts never reach.
  // Clearing the text or taking a chip back is what makes it go.
  const overLimit = value.length >= MAX_TAGS && normalizeTagName(query) !== '';
  const options = useMemo(
    () => (overLimit ? [] : matches(dictionary, value, query)),
    [overLimit, dictionary, value, query],
  );
  const expanded = open && options.length > 0;
  const message = overLimit ? `タグは ${MAX_TAGS} つまで設定できます。` : error;
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
        current.some((known) => known.slug === tag.slug) ? current : [...current, tag],
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
      // The list's Escape, not the drawer's. `useDismiss` listens on `document`, which under the
      // App Router is also React's root, so `stopPropagation` has no ancestor left to stop at — the
      // listener shares the node. React's was attached at hydration, before any effect's, so
      // stopping the rest of this node's listeners is what keeps the drawer open.
      event.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    } else if (event.key === 'Backspace' && query === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <div className='text-sm'>
      <span id={labelId} className='mb-1 block text-zinc-600 dark:text-zinc-400'>
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
      <div className='flex flex-wrap items-center gap-1.5 rounded border border-zinc-300 px-2 py-1.5 focus-within:ring-2 focus-within:ring-zinc-400 dark:border-zinc-700'>
        {value.map((slug) => {
          const name = names.get(slug) ?? slug;
          return (
            <span
              key={slug}
              className='inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pr-1 pl-2.5 text-xs dark:bg-zinc-800'>
              {name}
              <button
                type='button'
                aria-label={`「${name}」を外す`}
                onClick={() => onChange(value.filter((kept) => kept !== slug))}
                className='rounded-full p-0.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100'>
                <CloseIcon />
              </button>
            </span>
          );
        })}
        <input
          role='combobox'
          aria-labelledby={labelId}
          aria-autocomplete='list'
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded ? optionId(activeIndex) : undefined}
          value={query}
          aria-invalid={overLimit || undefined}
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
        className='mt-1 max-h-60 overflow-y-auto rounded border border-zinc-300 py-1 dark:border-zinc-700'>
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
            className={`cursor-pointer px-3 py-1.5 ${index === activeIndex ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}>
            {option.kind === 'existing'
              ? option.tag.name
              : `「${option.name}」を新しいタグとして追加`}
          </li>
        ))}
      </ul>
    </div>
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
