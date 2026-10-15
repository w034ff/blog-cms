import Link from 'next/link';

export function DraftPreviewBanner({ postId }: { postId: number }) {
  return (
    // Without this banner a preview is indistinguishable from the live post, so it is the
    // feature, not decoration. Outside the <article>: it is not part of the post.
    <div
      role='status'
      className='mx-auto mb-6 flex max-w-page flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-box border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'>
      <b className='font-semibold'>下書きのプレビュー</b>
      <Link
        href={`/admin/posts/${postId}/edit`}
        className='shrink-0 font-medium underline underline-offset-2'>
        編集に戻る
      </Link>
    </div>
  );
}
