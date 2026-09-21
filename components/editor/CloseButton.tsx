import type { Ref } from 'react';
import { CloseIcon } from './svg/CloseIcon';

// The close button every editor dialog puts in its title row — 記事の設定, 書き方ヘルプ and the
// insert dialog wrote the same button three times, and one of them growing alone would have left
// the other two behind. A 36px circle on a pointer, matching 記事一覧's arrow in the header; 40px
// under `hover: none` (`.dialog-close-button`, app/globals.css), the app's touch floor — on a
// phone this and the backdrop strip are the only ways out of 記事の設定. Was a 26px text ×.
//
// `type='button'` is load-bearing: 記事の設定 sits inside PostEditor's one <form>, and a button
// without it would publish the post.
export function CloseButton({
  onClick,
  ref,
}: {
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type='button'
      aria-label='閉じる'
      onClick={onClick}
      className='dialog-close-button inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'>
      <CloseIcon />
    </button>
  );
}
