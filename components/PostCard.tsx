import Link from "next/link";
import type { Post } from "@/lib/types";

type Props = {
  post: Post;
};

export function PostCard({ post }: Props) {
  return (
    <article className="border-b border-zinc-200 dark:border-zinc-800 py-6">
      <Link href={`/posts/${post.slug}`} className="group">
        <h2 className="text-2xl font-semibold tracking-tight group-hover:underline">
          {post.title}
        </h2>
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
        <time dateTime={post.date}>{formatDate(post.date)}</time>
        <Link
          href={`/categories/${encodeURIComponent(post.category)}`}
          className="hover:underline"
        >
          {post.category}
        </Link>
      </div>
      {post.description && (
        <p className="mt-3 text-zinc-700 dark:text-zinc-300">
          {post.description}
        </p>
      )}
      {post.tags.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <li key={tag}>
              <Link
                href={`/tags/${encodeURIComponent(tag)}`}
                className="inline-block rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-1 text-xs hover:bg-zinc-200 dark:hover:bg-zinc-700"
              >
                #{tag}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
