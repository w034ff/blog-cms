'use server';

import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/dal';
import { restoreRevision, type RestoreTarget } from '@/lib/revisions';

// The history's one write (docs/revision-requirements.md §5). Reached from the preview, so the
// result is shown by navigating to the editor, which mounts on the restored content. No
// revalidateBlog(): nothing public changed. A refused restore lands on the history page.
function parseTarget(raw: FormDataEntryValue | null): RestoreTarget | null {
  if (raw === 'live') return 'live';
  if (typeof raw !== 'string') return null;
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

export async function restoreRevisionAction(formData: FormData): Promise<void> {
  await verifySession();
  const postId = Number(formData.get('postId'));
  const target = parseTarget(formData.get('revision'));
  if (!Number.isInteger(postId)) redirect('/admin');
  const restored = target !== null && restoreRevision(postId, target);
  redirect(restored ? `/admin/posts/${postId}/edit` : `/admin/posts/${postId}/revisions`);
}
