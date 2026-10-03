import Link from 'next/link';
import type { Metadata } from 'next';
import { getAllTags } from '@/lib/posts';

export const metadata: Metadata = {
  title: 'Tags',
};

export const dynamic = 'force-dynamic';

export default async function TagsIndexPage() {
  const tags = await getAllTags();
  return (
    <section className='mx-auto w-full max-w-page'>
      <h1 className='text-3xl font-bold tracking-tight mb-6'>Tags</h1>
      {tags.length === 0 ? (
        <p className='text-zinc-600 dark:text-zinc-400'>タグはまだありません。</p>
      ) : (
        <ul className='flex flex-wrap gap-2'>
          {tags.map(({ slug, name, count }) => (
            <li key={slug}>
              <Link
                href={`/tags/${encodeURIComponent(slug)}`}
                className='tag-chip px-3 py-1 text-sm'>
                #{name} ({count})
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
