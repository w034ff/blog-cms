import type { Metadata } from 'next';
import Link from 'next/link';
import { verifyAdmin } from '@/lib/dal';
import { listDictionary, tagUsage } from '@/lib/tags';
import { TagDirectory } from './TagForms';

export const metadata: Metadata = { title: 'タグ' };

export const dynamic = 'force-dynamic';

// The tag dictionary's screen (docs/editor-requirements.md §12.33): the editor admits tags, this
// tidies them. The two names are the page's whole difficulty; its first line says what the
// identifier is for, and 表示名 explains itself.
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
        識別子はタグの URL に使います。
      </p>
      <TagDirectory tags={tags} usage={usage} />
    </section>
  );
}
