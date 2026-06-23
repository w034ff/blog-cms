import { PostEditor, type PostEditorInitial } from "@/components/PostEditor";
import { createPostAction } from "@/app/actions/posts";

const emptyInitial: PostEditorInitial = {
  slug: "",
  title: "",
  date: new Date().toISOString().slice(0, 10),
  description: "",
  category: "uncategorized",
  tags: [],
  draft: false,
  body: "",
};

export default function NewPostPage() {
  return (
    <section>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">新規記事</h1>
      <PostEditor action={createPostAction} initial={emptyInitial} mode="create" />
    </section>
  );
}
