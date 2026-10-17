'use client';

import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ALLOWED_IMAGE_ACCEPT } from '@/lib/uploads';
import { firstBodyImage } from '@/lib/thumbnail';
import { uploadImageFile } from '@/lib/upload-client';

type Props = {
  // The author's explicit choice; '' when they have made none. Mirrored into the
  // hidden input below, which is how autosave and publish both read it —
  // useAutosave snapshots the live form rather than React state.
  value: string;
  onChange: (next: string) => void;
  // The current markdown, for the fallback preview. Passed in rather than read
  // from the editor so this component stays a plain controlled field.
  body: string;
};

// The post's card image. Two states in one control, and the reason the second
// one is spelled out on screen: with no explicit choice the reader still sees a
// picture — the body's first upload (lib/thumbnail.ts) — so a field that showed
// nothing here would be describing a post that has an image as one that does
// not. The label under the preview is what separates 「選んだ」 from 「拾われた」.
//
// There are two routes to a choice and this field is one of them: the picker
// below uploads a picture the body need not contain, and an image's bubble menu
// (ImageBubble.tsx) marks one already in it. Both write the same `value`, so the
// preview here answers 「どの絵がカードになるか」 for either.
export function ThumbnailField({ value, onChange, body }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Only consulted when there is no explicit choice — resolveThumbnail's rule,
  // kept in the same order here so the editor cannot claim one image while the
  // published page shows another.
  const auto = value === '' ? firstBodyImage(body) : null;
  const shown = value || auto;

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
    <div className='block text-sm'>
      <span className='mb-1 block font-bold'>サムネイル</span>
      {/* The value the server reads. Every other metadata field here is
          uncontrolled with a defaultValue, but this one has no text box to type
          into — the state lives in React and this input is its only route into
          the FormData that useAutosave and the publish action both read. */}
      <input type='hidden' name='thumbnail' value={value} />
      <div className='flex items-center gap-3'>
        {shown ? (
          // A plain <img>, and `@next/next/no-img-element` is silenced rather
          // than obeyed. The same image appears on four surfaces, and one of
          // them — the public link card — is assembled by rehype as a hast tree
          // (lib/rehype-link-card.ts), where a React component cannot go. Using
          // next/image on the other three would leave the four disagreeing about
          // how a thumbnail is drawn to buy optimization on a listing of three
          // posts. Revisit if the archive grows enough for it to matter.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shown}
            alt=''
            className='h-16 w-28 shrink-0 rounded-chip border border-zinc-300 object-cover dark:border-zinc-700'
          />
        ) : (
          <div className='flex h-16 w-28 shrink-0 items-center justify-center rounded-chip border border-dashed border-zinc-300 text-xs text-zinc-400 dark:border-zinc-700'>
            なし
          </div>
        )}
        {/* The state first, then the controls: after the buttons it read as their caption. */}
        <div className='space-y-1.5'>
          <p className='text-xs text-zinc-500 dark:text-zinc-400'>
            {value !== ''
              ? '指定した画像'
              : auto
                ? '本文の最初の画像（自動）'
                : '本文の最初の画像が自動で入ります'}
          </p>
          <div className='flex gap-2'>
            {/* type='button' is load-bearing: inside PostEditor's <form>, a default
                submit button would publish the post. */}
            <button
              type='button'
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className='thumbnail-field-button rounded-box border border-zinc-300 px-3 text-sm hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800'>
              {uploading ? 'アップロード中…' : value ? '変更' : '画像を選ぶ'}
            </button>
            {value !== '' && (
              <button
                type='button'
                onClick={() => onChange('')}
                className='thumbnail-field-button rounded-box border border-zinc-300 px-3 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'>
                解除
              </button>
            )}
          </div>
        </div>
      </div>
      {/* No `name`, so an untouched picker contributes nothing to the form. */}
      <input
        data-testid='thumbnail-picker'
        ref={fileRef}
        type='file'
        accept={ALLOWED_IMAGE_ACCEPT}
        onChange={handleFile}
        className='hidden'
      />
    </div>
  );
}
