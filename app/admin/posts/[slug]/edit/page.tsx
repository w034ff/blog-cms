import { notFound } from "next/navigation";
import { PostEditor, type PostEditorInitial } from "@/components/PostEditor";
import { updatePostAction } from "@/app/actions/posts";
import { getPostForEdit } from "@/lib/posts";

export const dynamic = "force-dynamic";

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPostForEdit(slug);
  if (!post) notFound();

  const initial: PostEditorInitial = {
    slug: post.slug,
    title: post.title,
    date: post.date,
    description: post.description,
    category: post.category,
    tags: post.tags,
    draft: post.draft,
    body: post.body,
  };

  return (
    <section>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">記事を編集</h1>
      <PostEditor action={updatePostAction} initial={initial} mode="edit" />
    </section>
  );
}
