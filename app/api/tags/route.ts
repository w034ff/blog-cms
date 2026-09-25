import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOptionalSession } from '@/lib/dal';
import { createTag } from '@/lib/tags';

// Admit a tag from the editor's tag field (docs/editor-requirements.md §12.33). A route, not a
// server action: an action re-renders its page, and the editor must not re-render mid-edit.
// Answers the tag that now exists, new or the one the name already resolved to.
const bodySchema = z.object({ name: z.string() });

export async function POST(req: NextRequest) {
  if (!(await getOptionalSession())) {
    return new NextResponse(null, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '入力が不正です。' }, { status: 400 });
  }
  const result = createTag(parsed.data.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ tag: result.tag, created: result.created });
}
