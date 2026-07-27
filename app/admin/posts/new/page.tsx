import { PostEditor, type PostEditorInitial } from '@/components/PostEditor';
import { submitPostAction } from '@/app/actions/posts';
import { DEFAULT_CATEGORY } from '@/lib/content';

const emptyInitial: PostEditorInitial = {
  id: null,
  slug: '',
  title: '',
  description: '',
  category: DEFAULT_CATEGORY,
  tags: [],
  body: '',
};

export default function NewPostPage() {
  return (
    <section>
      <h1 className='mb-6 text-2xl font-bold tracking-tight'>新規記事</h1>
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
