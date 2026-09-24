import type { Ref } from 'react';
import { CloseIcon } from './svg/CloseIcon';

// The close button in every editor dialog's title row (記事の設定, 書き方ヘルプ, the insert
// dialog). A 36px circle on a pointer, matching 記事一覧's arrow; 40px under `hover: none`
// (`.dialog-close-button`, app/globals.css), the app's touch floor.
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
