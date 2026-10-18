import type { Metadata } from 'next';
import { verifyAdmin } from '@/lib/dal';
import { parseTagListParams } from '@/lib/admin-tag-list';
import { listDictionary, tagUsage } from '@/lib/tags';
import { TagDirectory } from './TagForms';
import { TagHelp } from './TagHelp';
import { ScreenHeading } from '../ScreenHeading';

export const metadata: Metadata = { title: 'タグの管理' };

export const dynamic = 'force-dynamic';

// The tag dictionary's screen (docs/editor-requirements.md §12.33): the editor admits tags, this
// tidies them. The two names are the page's whole difficulty; its first line says what the
// identifier is for, and 表示名 explains itself.
export default async function AdminTagsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await verifyAdmin();
  const params = parseTagListParams(await searchParams);
  const tags = listDictionary();
  const usage = Object.fromEntries(tagUsage());

  return (
    <section>
      <div className='mb-2 flex items-center gap-2'>
        <ScreenHeading title='タグの管理' admin />
        <TagHelp />
      </div>
      <p className='mb-6 text-sm text-zinc-600 dark:text-zinc-400'>
        識別子はタグの URL に使います。
      </p>
      <TagDirectory tags={tags} usage={usage} params={params} />
    </section>
  );
}
