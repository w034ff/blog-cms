'use client';

import { useId, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { DEFAULT_SHARE_IMAGE, DEFAULT_SITE_NAME } from '@/app/shared-metadata';
import { uploadImageFile } from '@/lib/upload-client';
import { ALLOWED_IMAGE_ACCEPT } from '@/lib/uploads';

const LABEL = '共有用の画像';
const HELP = '共有したときの画像に使います。1200×630 px がおすすめです。';
// Shown only while the committed image is in use, the one case it is true of. That image is drawn
// from DEFAULT_SITE_NAME (scripts/make-og-image.mts), so naming it here cannot drift from the
// picture, and it does not follow a rename (docs/site-settings-requirements.md §4).
const DEFAULT_NAME_NOTE = `既定の画像には「${DEFAULT_SITE_NAME}」の名前が描かれていて、サイトの名前を変えても変わりません。`;
const CHOSEN_STATE = '指定した画像';
const DEFAULT_STATE = '既定の画像';
const PICK_LABEL = '画像を選ぶ';
const CHANGE_LABEL = '変更';
const CLEAR_LABEL = '解除';
const UPLOADING_LABEL = 'アップロード中…';

const buttonClass =
  'thumbnail-field-button rounded-box border border-zinc-300 px-3 text-sm hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800';

// The site's share image (docs/site-settings-requirements.md §9), in the shape and words of the
// post settings' サムネイル (components/editor/ThumbnailField.tsx). Picking uploads at once; the
// path reaches the setting only when the form is saved, through the hidden input.
export function ShareImageField({
  value,
  onChange,
  error,
  noteClass,
  errorClass,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string;
  noteClass: string;
  errorClass: string;
}) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Cleared so picking the same file twice in a row still fires a change.
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImageFile(file);
      if (url !== null) onChange(url);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div role='group' aria-labelledby={`${id}-label`} className='flex flex-col gap-1.5'>
      <span id={`${id}-label`} className='text-sm font-semibold'>
        {LABEL}
      </span>
      <p className={noteClass}>{HELP}</p>
      <input type='hidden' name='shareImage' value={value} />
      <div className='flex items-center gap-3'>
        {/* A plain <img>, as ThumbnailField says why. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={value || DEFAULT_SHARE_IMAGE}
          alt=''
          className='h-16 w-28 shrink-0 rounded-chip border border-zinc-300 object-cover dark:border-zinc-700'
        />
        <div className='space-y-1.5'>
          <p className={noteClass}>{value ? CHOSEN_STATE : DEFAULT_STATE}</p>
          <div className='flex gap-2'>
            <button
              type='button'
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className={buttonClass}>
              {uploading ? UPLOADING_LABEL : value ? CHANGE_LABEL : PICK_LABEL}
            </button>
            {value !== '' && (
              <button type='button' onClick={() => onChange('')} className={buttonClass}>
                {CLEAR_LABEL}
              </button>
            )}
          </div>
        </div>
      </div>
      {value === '' && <p className={noteClass}>{DEFAULT_NAME_NOTE}</p>}
      {error && (
        <p role='alert' className={errorClass}>
          {error}
        </p>
      )}
      {/* No `name`, so an untouched picker contributes nothing to the form. */}
      <input
        data-testid='share-image-picker'
        ref={fileRef}
        type='file'
        accept={ALLOWED_IMAGE_ACCEPT}
        onChange={handleFile}
        className='hidden'
      />
    </div>
  );
}
