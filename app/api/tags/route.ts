import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOptionalSession } from '@/lib/dal';
import { createTag } from '@/lib/tags';

// Admit a tag into the dictionary from the editor's tag field (docs/editor-requirements.md §12.33),
// when the author confirms a name the dictionary does not have. A route handler rather than a
// server action: an action re-renders the page it is called from, and the editor is not a page to
// re-render mid-edit. Answers the tag that now exists — the new one, or the one the name already
// resolved to — so the field adds whichever it is.
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
