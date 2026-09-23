import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PostEditor, type PostEditorInitial } from '@/components/PostEditor';
import { submitPostAction } from '@/app/actions/posts';
import { getPostForEdit, liveContent } from '@/lib/posts';
import { listDictionary } from '@/lib/tags';

export const dynamic = 'force-dynamic';

// The h1 that used to say this is gone — the editor's own title field says which post this
// is, and a heading repeating the screen's purpose was one more band between the top of the
// page and the post. The label moves to the tab title, which is all that still separates a
// new post from an edit — two open edits read alike there, which is what the title field is for.
export const metadata: Metadata = { title: '記事を編集' };

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const postId = Number(id);
  const post = Number.isInteger(postId) ? await getPostForEdit(postId) : null;
  if (!post) notFound();

  // Resume from the private working copy (pending edits) when present; otherwise
  // load the published content.
  const content = post.draftContent ?? liveContent(post);
  // slug is null while a draft — the editor derives an editable preview from the
  // title and finalizes it at publish.
  const initial: PostEditorInitial = { id: post.id, slug: post.slug ?? '', ...content };

  return (
    <section>
      <PostEditor
        action={submitPostAction}
        initial={initial}
        mode='edit'
        published={!post.draft}
        // `date` is stamped at first publish and never cleared (lib/posts-write.ts).
        everPublished={post.date !== ''}
        hasPendingEdits={post.hasPendingEdits}
        tagDictionary={listDictionary()}
      />
    </section>
  );
}
