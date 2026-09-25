import type { Metadata } from 'next';
import { PostEditor, type PostEditorInitial } from '@/components/PostEditor';
import { submitPostAction } from '@/app/actions/posts';
import { listDictionary } from '@/lib/tags';

// No h1: the editor's title field names the post. The tab title tells new from edit.
export const metadata: Metadata = { title: '新規記事' };

// The tag dictionary changes at any time; static, a build would freeze it.
export const dynamic = 'force-dynamic';

const emptyInitial: PostEditorInitial = {
  id: null,
  slug: '',
  title: '',
  // Not chosen: publish asks for it (§12.32).
  category: '',
  tags: [],
  body: '',
  thumbnail: '',
};

export default function NewPostPage() {
  return (
    <section>
      <PostEditor
        action={submitPostAction}
        initial={emptyInitial}
        mode='create'
        published={false}
        everPublished={false}
        hasPendingEdits={false}
        tagDictionary={listDictionary()}
      />
    </section>
  );
}
