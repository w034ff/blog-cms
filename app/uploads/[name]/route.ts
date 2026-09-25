import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ALLOWED_IMAGE_EXTENSIONS } from '@/lib/uploads';

// Uploaded images, read from disk on each request. Not `public/`: `setupFsCheck`
// (next/dist/server/lib/router-utils/filesystem.js) fills `publicFolderItems` once at boot
// `if (!opts.dev)`, so under `next start` a file written after boot 404s until a restart. Uploads
// are runtime data in `data/uploads`; the public URL (`/uploads/<name>`) is unchanged.

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');

// lib/uploads.ts's type → extension pairs, read the other way round.
const CONTENT_TYPES = new Map<string, string>(
  Array.from(ALLOWED_IMAGE_EXTENSIONS, ([type, ext]): [string, string] => [ext, type]),
);

// A name as `app/api/uploads/route.ts` writes it: sha256 of the content, then an allowed extension.
// A full match leaves no separator, dot segment or encoded byte, which is what makes the join safe.
const NAME = new RegExp(`^[0-9a-f]{64}\\.(${Array.from(CONTENT_TYPES.keys()).join('|')})$`);

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const ext = NAME.exec(name)?.[1];
  const contentType = ext && CONTENT_TYPES.get(ext);
  if (!contentType) return new NextResponse(null, { status: 404 });

  const bytes = await readFile(path.join(UPLOAD_DIR, name)).catch(() => null);
  if (!bytes) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': contentType,
      // Author-supplied bytes from this origin: `nosniff` stops a browser promoting them past the
      // allowed type (as in app/api/link-image/route.ts).
      'X-Content-Type-Options': 'nosniff',
      // The name is the body's sha256, so a URL never answers differently.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
