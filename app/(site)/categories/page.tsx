import Link from 'next/link';
import type { Metadata } from 'next';
import { categoryLabel } from '@/lib/content';
import { getAllCategories } from '@/lib/posts';

export const metadata: Metadata = {
  title: 'Categories',
};

export const dynamic = 'force-dynamic';

export default async function CategoriesIndexPage() {
  const categories = await getAllCategories();
  return (
    <section className='mx-auto w-full max-w-site'>
      <h1 className='text-3xl font-bold tracking-tight mb-6'>Categories</h1>
      {categories.length === 0 ? (
        <p className='text-zinc-600 dark:text-zinc-400'>カテゴリはまだありません。</p>
      ) : (
        <ul className='space-y-2'>
          {categories.map(({ category, count }) => (
            <li key={category}>
              <Link
                href={`/categories/${encodeURIComponent(category)}`}
                data-category={category}
                className='category-mark inline-block hover:underline'>
                {categoryLabel(category)}{' '}
                <span className='text-zinc-600 dark:text-zinc-400'>({count})</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
