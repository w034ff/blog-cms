import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getOptionalSession } from '@/lib/dal';
import { db } from '@/lib/db';
import { UPLOAD_DIR } from '@/lib/upload-dir';
import { prepareUploadImage } from '@/lib/upload-image';
import {
  diskFloorRefusal,
  hasUploadRow,
  readUploadAccount,
  recordUpload,
  removeUploadRow,
  type UploadRefusal,
} from '@/lib/upload-quota';
import { ALLOWED_IMAGE_EXTENSIONS, MAX_UPLOAD_BYTES } from '@/lib/uploads';

// Runtime data beside the DB, not `public/` (app/uploads/[name]/route.ts serves these and says
// why); `scripts/gc-uploads.mts` sweeps the same directory. Where it is: lib/upload-dir.ts.

export async function POST(req: NextRequest) {
  const session = await getOptionalSession();
  if (!session) {
    return new NextResponse(null, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'malformed form data' }, { status: 400 });
  }
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  if (!ALLOWED_IMAGE_EXTENSIONS.has(file.type)) {
    return NextResponse.json(
      { error: 'unsupported file type (png, jpg, gif, webp only)' },
      { status: 400 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'file too large (max 5MB)' }, { status: 400 });
  }

  const prepared = await prepareUploadImage(Buffer.from(await file.arrayBuffer()));
  if (!prepared) {
    return NextResponse.json({ error: 'file is not a readable image' }, { status: 400 });
  }
  const { bytes, ext } = prepared;
  // Content-addressed, so identical images are stored once and one file may serve several posts:
  // deletion must stay reference-based (the GC sweep is). The hash is of the stored bytes, not the
  // uploaded ones, so an upload that carries metadata never resolves to a file stored with it.
  const name = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
  const filePath = path.join(UPLOAD_DIR, name);
  await mkdir(UPLOAD_DIR, { recursive: true });

  // The limits (docs/abuse-limits-requirements.md §5). A name the account already holds costs it
  // nothing, so re-uploading an image it has is never refused for a limit it has since reached.
  const sqlite = db.$client;
  const account = readUploadAccount(sqlite, session.userId);
  let recorded = false;
  if (!hasUploadRow(sqlite, account.userId, name)) {
    const full = account.isAdmin ? null : await diskFloorRefusal(UPLOAD_DIR);
    if (full) return refuse(full);
    const outcome = recordUpload(sqlite, account, name, bytes.length, Date.now());
    if ('refused' in outcome) return refuse(outcome.refused);
    recorded = outcome.recorded;
  }

  try {
    const exists = await access(filePath).then(
      () => true,
      () => false,
    );
    if (!exists) {
      await writeFile(filePath, bytes);
    }
  } catch {
    // A row for a file that was never written would count against the account for good.
    if (recorded) removeUploadRow(sqlite, account.userId, name);
    return NextResponse.json({ error: 'could not store the file' }, { status: 500 });
  }

  return NextResponse.json({ url: `/uploads/${name}` });
}

function refuse({ status, error }: UploadRefusal): NextResponse {
  return NextResponse.json({ error }, { status });
}
