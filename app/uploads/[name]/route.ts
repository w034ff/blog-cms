import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ALLOWED_IMAGE_EXTENSIONS } from '@/lib/uploads';

// Uploaded images, read from disk on each request.
//
// They used to sit in `public/uploads` and be served by Next's static handler, which does not
// work for files written while the server is running: `setupFsCheck` (in
// next/dist/server/lib/router-utils/filesystem.js) fills `publicFolderItems` once at boot under
// `if (!opts.dev)`, and later serves a path only `if (matchedItem || opts.dev)`. `next dev` reads
// the disk every time, so the difference is invisible in development — but under `next start`
// every image uploaded after boot 404s until the server restarts. Measured 2026-09-13: a file
// present at boot answers 200, a new one written after boot answers 404.
//
// So an upload is runtime data, not a build-time asset. It lives in `data/uploads`, beside the
// DB, and this route is what serves it. The public URL is unchanged (`/uploads/<name>`), so the
// markdown already stored in published posts still resolves.

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');

// The extension the name carries back to the type it was stored as. `lib/uploads.ts` owns the
// pairs; this is that map read the other way round.
const CONTENT_TYPES = new Map<string, string>(
  Array.from(ALLOWED_IMAGE_EXTENSIONS, ([type, ext]): [string, string] => [ext, type]),
);

// A name as `app/api/uploads/route.ts` writes it: the sha256 of the content, then one allowed
// extension. Matching the whole name against this is also what makes the join below safe — a
// separator, a dot segment or an encoded byte cannot survive it, so a traversal has nothing to
// work with and no normalisation step is needed.
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
      // Author-supplied bytes served from this origin — the same reasoning as
      // app/api/link-image/route.ts: `nosniff` is what stops a browser deciding for itself that
      // they are something more interesting than the type we allowed.
      'X-Content-Type-Options': 'nosniff',
      // The name *is* the sha256 of the body, so a given URL can never answer differently.
      // `public/` could not promise that, and Next caps it there at `max-age=0`.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
