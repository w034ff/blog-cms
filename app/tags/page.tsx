import Link from "next/link";
import type { Metadata } from "next";
import { getAllTags } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Tags",
};

export const dynamic = "force-dynamic";

export default async function TagsIndexPage() {
  const tags = await getAllTags();
  return (
    <section>
      <h1 className="text-3xl font-bold tracking-tight mb-6">Tags</h1>
      {tags.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400">タグはまだありません。</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {tags.map(({ tag, count }) => (
            <li key={tag}>
              <Link
                href={`/tags/${encodeURIComponent(tag)}`}
                className="inline-block rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-200 dark:hover:bg-zinc-700"
              >
                #{tag}{" "}
                <span className="text-zinc-500 dark:text-zinc-400">
                  ({count})
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
