'use client';

import { firstBodyImage } from '@/lib/thumbnail';

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
// The choice itself is made in the body, not here: an image's bubble menu
// (ImageBubble.tsx) is the only way to set `value`, so this is read-only display
// plus 解除 — there is no picker, because the author is never choosing a picture
// that is not already in the post.
export function ThumbnailField({ value, onChange, body }: Props) {
  // Only consulted when there is no explicit choice — resolveThumbnail's rule,
  // kept in the same order here so the editor cannot claim one image while the
  // published page shows another.
  const auto = value === '' ? firstBodyImage(body) : null;
  const shown = value || auto;

  return (
    <div className='block text-sm'>
      <span className='mb-1 block text-zinc-600 dark:text-zinc-400'>サムネイル</span>
      {/* The value the server reads. Every other metadata field here is
          uncontrolled with a defaultValue, but this one has no text box to type
          into — the state lives in React and this input is its only route into
          the FormData that useAutosave and the publish action both read. */}
      <input type='hidden' name='thumbnail' value={value} />
      <div className='flex items-start gap-3'>
        {shown ? (
          // A plain <img>, and `@next/next/no-img-element` is silenced rather
          // than obeyed. The same image appears on three surfaces, and one of
          // them — the public link card — is assembled by rehype as a hast tree
          // (lib/rehype-link-card.ts), where a React component cannot go. Using
          // next/image on the other two would leave the three disagreeing about
          // how a thumbnail is drawn to buy optimization on a listing of three
          // posts. Revisit if the archive grows enough for it to matter.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shown}
            alt=''
            className='h-16 w-28 shrink-0 rounded border border-zinc-300 object-cover dark:border-zinc-700'
          />
        ) : (
          <div className='flex h-16 w-28 shrink-0 items-center justify-center rounded border border-dashed border-zinc-300 text-xs text-zinc-400 dark:border-zinc-700'>
            なし
          </div>
        )}
        <div className='space-y-1'>
          {value !== '' && (
            <button
              type='button'
              onClick={() => onChange('')}
              className='rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'>
              解除
            </button>
          )}
          <p className='text-xs text-zinc-500 dark:text-zinc-400'>
            {value !== ''
              ? 'この記事用に指定した画像です。'
              : auto
                ? '本文の最初の画像を自動で使用中。'
                : '未設定。本文に画像を入れると指定できます。'}
          </p>
        </div>
      </div>
    </div>
  );
}
