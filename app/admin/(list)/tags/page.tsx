import type { Metadata } from 'next';
import Link from 'next/link';
import { verifyAdmin } from '@/lib/dal';
import { listDictionary, tagUsage } from '@/lib/tags';
import { TagDirectory } from './TagForms';

export const metadata: Metadata = { title: 'タグ' };

export const dynamic = 'force-dynamic';

// The tag dictionary's screen (docs/editor-requirements.md §12.33): the editor admits tags, this
// tidies them. The two names are the page's whole difficulty, so its first line says which is which.
export default async function AdminTagsPage() {
  await verifyAdmin();
  const tags = listDictionary();
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
      <TagDirectory tags={tags} usage={usage} />
    </section>
  );
}
