import { NextResponse, type NextRequest } from 'next/server';
import { loadImage, verifyImageUrl } from '@/lib/link-image';

// The external link card's picture, served from this site (docs/link-card-requirements.md §14.4).
// `lib/link-image.ts` holds the signing and the fetch; this is the door.
//
// **The only route here a reader may call**, so the signature is the gate, checked before any
// fetch. The address guard behind `fetchImage` runs anyway: a signature is only as good as the
// secret, and a mistake here would be an open image proxy on a home network.

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  const sig = req.nextUrl.searchParams.get('sig');
  // 404 for every refusal, bad signature included, so a prober cannot tell which URLs we know.
  if (!url || !sig || !verifyImageUrl(url, sig)) return new NextResponse(null, { status: 404 });

  const image = await loadImage(url);
  if (!image) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.contentType,
      // Third-party bytes from this origin: `nosniff` stops a browser promoting them past the type.
      'X-Content-Type-Options': 'nosniff',
      // A week, matching the row's TTL (lib/link-previews.ts). Only advice: the URL is public, and what
      // bounds the outbound side is the cache and the in-flight map in lib/link-image.ts.
      'Cache-Control': 'public, max-age=604800, immutable',
    },
  });
}
