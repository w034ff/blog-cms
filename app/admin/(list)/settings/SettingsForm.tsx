'use client';

import { useActionState, useId, useState } from 'react';
import { saveSiteSettingsAction, type SettingsFormState } from '@/app/actions/settings';
import type { SiteIdentity } from '@/app/shared-metadata';
import {
  SITE_DESCRIPTION_MAX_CHARS,
  SITE_NAME_MAX_CHARS,
  codePointLength,
} from '@/lib/site-settings-rules';

const NAME_LABEL = 'サイトの名前';
const DESCRIPTION_LABEL = '説明文';
const DESCRIPTION_HELP = 'ページの説明、共有したときの説明、RSS に使います。';
const SAVE_LABEL = '保存';
const SAVING_LABEL = '保存中…';
const SAVED_MESSAGE = '保存しました';
// The two pictures with the name drawn into them do not follow the setting
// (docs/site-settings-requirements.md §4).
const BAKED_NOTE = '共有用の画像とリンクカードの絵の名前は変わりません。';

const inputClass =
  'w-full min-w-0 rounded-box border border-zinc-300 bg-surface px-3 py-2 text-sm focus:ring-2 focus:ring-zinc-400 focus:outline-none aria-invalid:border-red-600 dark:border-zinc-700 dark:aria-invalid:border-red-400';
const noteClass = 'text-xs text-zinc-600 dark:text-zinc-400';
const errorClass = 'text-xs text-red-700 dark:text-red-400';

const emptyState: SettingsFormState = {};

function Field({
  label,
  name,
  value,
  max,
  error,
  help,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  max: number;
  error?: string;
  help?: string;
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
      <input
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={noteId}
        className={inputClass}
      />
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

// The settings screen's one form (docs/site-settings-requirements.md §5). Controlled, so the
// counters follow typing; the action reads the submitted FormData either way.
export function SettingsForm({ initial }: { initial: SiteIdentity }) {
  const [state, formAction, pending] = useActionState(saveSiteSettingsAction, emptyState);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);

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
        // The check carries the green: `--good` on the white sheet is 4.37:1, under the 4.5:1 a
        // line of small text needs, and enough for a mark (3:1).
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
        label={NAME_LABEL}
        name='name'
        value={name}
        max={SITE_NAME_MAX_CHARS}
        error={state.errors?.name}
        onChange={setName}
      />
      <Field
        label={DESCRIPTION_LABEL}
        name='description'
        value={description}
        max={SITE_DESCRIPTION_MAX_CHARS}
        error={state.errors?.description}
        help={DESCRIPTION_HELP}
        onChange={setDescription}
      />
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <p className={noteClass}>{BAKED_NOTE}</p>
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
