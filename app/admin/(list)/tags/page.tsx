import type { Metadata } from 'next';
import { verifyAdmin } from '@/lib/dal';
import { listDictionary, tagUsage } from '@/lib/tags';
import { TagDirectory } from './TagForms';
import { ScreenHeading } from '../ScreenHeading';

export const metadata: Metadata = { title: 'タグの管理' };

export const dynamic = 'force-dynamic';

// The tag dictionary's screen (docs/editor-requirements.md §12.33): the editor admits tags, this
// tidies them. The two names are the page's whole difficulty; its first line says what the
// identifier is for, and 表示名 explains itself.
export default async function AdminTagsPage() {
  await verifyAdmin();
  const tags = listDictionary();
  const usage = Object.fromEntries(tagUsage());

  return (
    <section>
      <div className='mb-2'>
        <ScreenHeading title='タグの管理' showTags />
      </div>
      <p className='mb-6 text-sm text-zinc-600 dark:text-zinc-400'>
        識別子はタグの URL に使います。
      </p>
      {/* On a white sheet, as 記事一覧's list is. */}
      <div className='rounded-panel border border-zinc-200 bg-surface p-4 dark:border-zinc-800 sm:p-6'>
        <TagDirectory tags={tags} usage={usage} />
      </div>
    </section>
  );
}
