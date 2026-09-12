import type { Metadata } from 'next';
import { PostEditor, type PostEditorInitial } from '@/components/PostEditor';
import { submitPostAction } from '@/app/actions/posts';
import { DEFAULT_CATEGORY } from '@/lib/content';

// The h1 that used to say this is gone — the editor's own title field says which post this
// is, and a heading repeating the screen's purpose was one more band between the top of the
// page and the post. The label moves to the tab title, which is all that still separates a
// new post from an edit — two open edits read alike there, which is what the title field is for.
export const metadata: Metadata = { title: '新規記事' };

const emptyInitial: PostEditorInitial = {
  id: null,
  slug: '',
  title: '',
  description: '',
  category: DEFAULT_CATEGORY,
  tags: [],
  body: '',
  thumbnail: '',
  unlisted: false,
};

export default function NewPostPage() {
  return (
    <section>
      <PostEditor
        action={submitPostAction}
        initial={emptyInitial}
        mode='create'
        published={false}
        hasPendingEdits={false}
      />
    </section>
  );
}
