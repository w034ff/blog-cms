import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PostEditor, type PostEditorInitial } from '@/components/PostEditor';
import { submitPostAction } from '@/app/actions/posts';
import { getPostForEdit, liveContent } from '@/lib/posts';
import { listDictionary } from '@/lib/tags';
import { EDIT_POST_TITLE } from '@/app/shared-metadata';

export const dynamic = 'force-dynamic';

// No h1: the editor's title field names the post. The tab title tells new from edit.
export const metadata: Metadata = { title: EDIT_POST_TITLE };

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const postId = Number(id);
  const post = Number.isInteger(postId) ? await getPostForEdit(postId) : null;
  if (!post) notFound();

  // The private working copy (pending edits) when present, else the live content.
  const content = post.draftContent ?? liveContent(post);
  // Non-null for every row since creation (app/api/drafts/route.ts); the column is nullable only.
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
        kind={post.kind}
      />
    </section>
  );
}
