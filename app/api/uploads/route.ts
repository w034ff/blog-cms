import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getOptionalSession } from '@/lib/dal';
import { UPLOAD_DIR } from '@/lib/upload-dir';
import { ALLOWED_IMAGE_EXTENSIONS, MAX_UPLOAD_BYTES } from '@/lib/uploads';

// Runtime data beside the DB, not `public/` (app/uploads/[name]/route.ts serves these and says
// why); `scripts/gc-uploads.mts` sweeps the same directory. Where it is: lib/upload-dir.ts.

export async function POST(req: NextRequest) {
  const session = await getOptionalSession();
  if (!session) {
    return new NextResponse(null, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  const ext = ALLOWED_IMAGE_EXTENSIONS.get(file.type);
  if (!ext) {
    return NextResponse.json(
      { error: 'unsupported file type (png, jpg, gif, webp only)' },
      { status: 400 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'file too large (max 5MB)' }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // Content-addressed, so identical images are stored once and one file may serve several posts:
  // deletion must stay reference-based (the GC sweep is).
  const name = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
  const filePath = path.join(UPLOAD_DIR, name);
  await mkdir(UPLOAD_DIR, { recursive: true });
  const exists = await access(filePath).then(
    () => true,
    () => false,
  );
  if (!exists) {
    await writeFile(filePath, bytes);
  }

  return NextResponse.json({ url: `/uploads/${name}` });
}
