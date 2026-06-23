import Link from "next/link";
import type { Metadata } from "next";
import { getAllCategories } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Categories",
};

export const dynamic = "force-dynamic";

export default async function CategoriesIndexPage() {
  const categories = await getAllCategories();
  return (
    <section>
      <h1 className="text-3xl font-bold tracking-tight mb-6">Categories</h1>
      {categories.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400">
          カテゴリはまだありません。
        </p>
      ) : (
        <ul className="space-y-2">
          {categories.map(({ category, count }) => (
            <li key={category}>
              <Link
                href={`/categories/${encodeURIComponent(category)}`}
                className="inline-block hover:underline"
              >
                {category}{" "}
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
