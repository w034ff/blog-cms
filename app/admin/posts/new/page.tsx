import { getSiteIdentity } from '@/lib/site-settings';
import type { Metadata } from 'next';
import { PostEditor, type PostEditorInitial } from '@/components/PostEditor';
import { submitPostAction } from '@/app/actions/posts';
import { listDictionary } from '@/lib/tags';

// No h1: the editor's title field names the post. The tab title tells new from edit.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { kind } = await searchParams;
  return { title: kind === 'scribble' ? '新しい走り書き' : '新規記事' };
}

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

export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { kind } = await searchParams;
  const isScribble = kind === 'scribble';

  return (
    <section>
      <PostEditor
        siteName={(await getSiteIdentity()).name}
        action={submitPostAction}
        initial={emptyInitial}
        mode='create'
        published={false}
        everPublished={false}
        hasPendingEdits={false}
        tagDictionary={listDictionary()}
        kind={isScribble ? 'scribble' : 'post'}
      />
    </section>
  );
}
