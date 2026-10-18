'use client';

import { useActionState, useId, useState } from 'react';
import { saveAccountAction, type AccountFormState } from '@/app/actions/account';
import { HANDLE_MAX_CHARS } from '@/lib/handle-rules';
import { codePointLength } from '@/lib/site-settings-rules';

const DISPLAY_NAME_LABEL = '表示名';
const DISPLAY_NAME_HELP = '記事と走り書きのページに著者名として出ます。';
// Said only to someone who may clear the name (docs/multi-author-requirements.md §10.4).
const DISPLAY_NAME_EMPTY_HELP = `${DISPLAY_NAME_HELP}空にすると出しません。`;
const HANDLE_LABEL = 'ID';
// Said before the ID is chosen, since choosing it is final (docs/multi-author-requirements.md §13.4).
const HANDLE_HELP = '一度決めると ID は変えられません。';
const SAVE_LABEL = '保存';
const SAVING_LABEL = '保存中…';
const SAVED_MESSAGE = '保存しました';

const inputClass =
  'w-full min-w-0 rounded-box border border-zinc-300 bg-surface px-3 py-2 text-sm focus:ring-2 focus:ring-zinc-400 focus:outline-none aria-invalid:border-red-600 dark:border-zinc-700 dark:aria-invalid:border-red-400';
const noteClass = 'text-xs text-zinc-600 dark:text-zinc-400';
const errorClass = 'text-xs text-red-700 dark:text-red-400';

const emptyState: AccountFormState = {};

function Field({
  label,
  name,
  value,
  max,
  error,
  help,
  prefix,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  max: number;
  error?: string;
  help?: string;
  // Fixed text drawn inside the box before what is typed, such as the @ of an ID.
  prefix?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className='flex flex-col gap-1.5'>
      <label htmlFor={id} className='text-sm font-semibold'>
        {label}
      </label>
      {help && <p className={noteClass}>{help}</p>}
      {prefix ? (
        <div className='flex w-full min-w-0 items-center rounded-box border border-zinc-300 bg-surface px-3 text-sm focus-within:ring-2 focus-within:ring-zinc-400 has-aria-invalid:border-red-600 dark:border-zinc-700 dark:has-aria-invalid:border-red-400'>
          <span aria-hidden='true' className='text-zinc-500 dark:text-zinc-400'>
            {prefix}
          </span>
          <input
            id={id}
            name={name}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={noteId}
            autoCapitalize='none'
            spellCheck={false}
            className='w-full min-w-0 bg-transparent py-2 pl-0.5 focus:outline-none'
          />
        </div>
      ) : (
        <input
          id={id}
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={noteId}
          className={inputClass}
        />
      )}
      <div id={noteId} className='flex justify-between gap-4'>
        <span className={errorClass} role={error ? 'alert' : undefined}>
          {error}
        </span>
        <span className={`${noteClass} tabular-nums`}>
          {codePointLength(value.trim())} / {max}
        </span>
      </div>
    </div>
  );
}

// The account settings screen's one form (docs/multi-author-requirements.md §6.1).
// Controlled so the counter follows typing; the action reads the submitted FormData either way.
export function AccountForm({
  initialDisplayName,
  max = 20,
  canBeEmpty,
  handle: currentHandle,
  handleChosen,
}: {
  initialDisplayName: string;
  max?: number;
  canBeEmpty: boolean;
  // The ID without its @, and whether it is already fixed (docs/multi-author-requirements.md §13.4).
  handle: string;
  handleChosen: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveAccountAction, emptyState);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [handle, setHandle] = useState(currentHandle);

  return (
    <form
      action={formAction}
      className='flex max-w-xl flex-col gap-6 rounded-panel border border-zinc-200 bg-surface p-5 dark:border-zinc-800'>
      {state.error && (
        <p role='alert' className={errorClass}>
          {state.error}
        </p>
      )}
      {state.at && !pending && (
        <p role='status' className='flex items-center gap-1.5 text-sm'>
          <svg aria-hidden='true' viewBox='0 0 16 16' className='h-4 w-4 text-(--good)'>
            <path
              d='M3 8.5l3 3 7-7'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </svg>
          {SAVED_MESSAGE}
        </p>
      )}
      <Field
        label={DISPLAY_NAME_LABEL}
        name='displayName'
        value={displayName}
        max={max}
        error={state.errors?.displayName}
        help={canBeEmpty ? DISPLAY_NAME_EMPTY_HELP : DISPLAY_NAME_HELP}
        onChange={setDisplayName}
      />
      {handleChosen ? (
        // A fixed ID is not a field: the form sends no `handle`, and the action refuses one anyway.
        <p className='text-sm'>
          <span className='font-semibold'>{HANDLE_LABEL}:</span> @{currentHandle}
        </p>
      ) : (
        <Field
          label={HANDLE_LABEL}
          name='handle'
          value={handle}
          max={HANDLE_MAX_CHARS}
          error={state.errors?.handle}
          help={HANDLE_HELP}
          prefix='@'
          onChange={setHandle}
        />
      )}
      <div className='flex justify-end'>
        <button
          type='submit'
          disabled={pending}
          className='button-primary px-4 py-2 text-sm font-medium disabled:opacity-40'>
          {pending ? SAVING_LABEL : SAVE_LABEL}
        </button>
      </div>
    </form>
  );
}
