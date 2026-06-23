import { getAllPosts } from '@/lib/posts';
import { PostCard } from '@/components/PostCard';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const posts = await getAllPosts();
  return (
    <section>
      <h1 className='text-3xl font-bold tracking-tight mb-6'>最新の記事</h1>
      {posts.length === 0 ? (
        <p className='text-zinc-500 dark:text-zinc-400'>まだ記事がありません。</p>
      ) : (
        <div className='divide-y divide-zinc-200 dark:divide-zinc-800'>
          {posts.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      )}
    </section>
  );
}
