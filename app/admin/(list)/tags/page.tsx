import type { Metadata } from 'next';
import Link from 'next/link';
import { verifySession } from '@/lib/dal';
import { listTags, tagUsage } from '@/lib/tags';
import { NewTagForm, TagRow } from './TagForms';

export const metadata: Metadata = { title: 'タグ' };

export const dynamic = 'force-dynamic';

// The tag dictionary's own screen (docs/editor-requirements.md §12.33): the editor admits tags as
// they are written, and this is where they are tidied — a display name given, an identifier
// changed or merged into another, a tag removed from every post. The two names are the page's
// whole difficulty, so it says in one line which is which before anything else.
export default async function AdminTagsPage() {
  await verifySession();
  const tags = listTags();
  const usage = tagUsage();
  const slugs = tags.map((tag) => tag.slug);

  return (
    <section>
      <div className='mb-6 flex items-center justify-between gap-4'>
        <h1 className='text-2xl font-bold tracking-tight'>タグ</h1>
        <Link href='/admin' className='text-sm hover:underline'>
          記事一覧
        </Link>
      </div>
      <p className='mb-4 text-sm text-zinc-600 dark:text-zinc-400'>
        表示名は、記事やタグページで読者に見える名前です。識別子は、エディタでタグを付けるときに入力する語で、タグページの
        URL にも使われます。
      </p>
      <NewTagForm />
      {tags.length === 0 ? (
        <p className='mt-6 text-zinc-500 dark:text-zinc-400'>タグはまだありません。</p>
      ) : (
        <ul className='mt-6 divide-y divide-zinc-200 dark:divide-zinc-800'>
          {tags.map((tag) => (
            <TagRow
              key={`${tag.slug}:${tag.name}`}
              tag={tag}
              usage={usage.get(tag.slug) ?? 0}
              slugs={slugs}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
