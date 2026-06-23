import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOptionalSession } from '@/lib/dal';
import { renderMdxToHtml } from '@/lib/render';

const previewSchema = z.object({ source: z.string() });

export async function POST(req: NextRequest) {
  const session = await getOptionalSession();
  if (!session) {
    return new NextResponse(null, { status: 401 });
  }

  const parsed = previewSchema.safeParse(await req.json().catch(() => null));
  const source = parsed.success ? parsed.data.source : '';
  const html = await renderMdxToHtml(source);
  return NextResponse.json({ html });
}
