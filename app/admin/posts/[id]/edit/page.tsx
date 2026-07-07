import { notFound } from 'next/navigation';
import { PostEditor, type PostEditorInitial } from '@/components/PostEditor';
import { submitPostAction } from '@/app/actions/posts';
import { getPostForEdit } from '@/lib/posts';

export const dynamic = 'force-dynamic';

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const postId = Number(id);
  const post = Number.isInteger(postId) ? await getPostForEdit(postId) : null;
  if (!post) notFound();

  // Resume from the private working copy (pending edits) when present; otherwise
  // load the published content.
  const content = post.draftContent ?? {
    title: post.title,
    description: post.description,
    category: post.category,
    tags: post.tags,
    body: post.body,
  };
  // slug is null while a draft — the editor derives an editable preview from the
  // title and finalizes it at publish.
  const initial: PostEditorInitial = { id: post.id, slug: post.slug ?? '', ...content };

  return (
    <section>
      <h1 className='mb-6 text-2xl font-bold tracking-tight'>記事を編集</h1>
      <PostEditor
        action={submitPostAction}
        initial={initial}
        mode='edit'
        published={!post.draft}
        hasPendingEdits={post.draftContent !== null}
      />
    </section>
  );
}
