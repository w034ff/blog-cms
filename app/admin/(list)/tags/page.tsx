import type { Metadata } from 'next';
import Link from 'next/link';
import { verifySession } from '@/lib/dal';
import { listTags, tagUsage } from '@/lib/tags';
import { NewTagForm, TagTable } from './TagForms';

export const metadata: Metadata = { title: 'タグ' };

export const dynamic = 'force-dynamic';

// The tag dictionary's own screen (docs/editor-requirements.md §12.33): the editor admits tags as
// they are written, and this is where they are tidied — a display name given, an identifier
// changed or merged into another, a tag removed from every post. The two names are the page's
// whole difficulty, so it says in one line which is which before anything else.
export default async function AdminTagsPage() {
  await verifySession();
  const tags = listTags();
  const usage = Object.fromEntries(tagUsage());

  return (
    <section>
      <div className='mb-2 flex items-center justify-between gap-4'>
        <h1 className='text-2xl font-bold tracking-tight'>タグ</h1>
        <Link href='/admin' className='text-sm hover:underline'>
          記事一覧
        </Link>
      </div>
      <p className='mb-6 text-sm text-zinc-500 dark:text-zinc-400'>
        識別子はエディタで入力する語で、URL にも使われます。表示名は読者に見える名前です。
      </p>
      <NewTagForm />
      <div className='mt-8'>
        {tags.length === 0 ? (
          <p className='text-zinc-500 dark:text-zinc-400'>タグはまだありません。</p>
        ) : (
          <TagTable tags={tags} usage={usage} />
        )}
      </div>
    </section>
  );
}
