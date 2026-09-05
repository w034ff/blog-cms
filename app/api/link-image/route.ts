import { NextResponse, type NextRequest } from 'next/server';
import { loadImage, verifyImageUrl } from '@/lib/link-image';

// The external link card's picture, served from this site rather than from the target's CDN
// (docs/link-card-requirements.md §14.4). `lib/link-image.ts` holds the signing and the fetch;
// this is the door.
//
// **The only route here a reader may call.** It cannot be admin-gated — the whole point is that a
// reader's browser loads it — so the signature is the gate, and it is checked before anything is
// fetched. What reaches the network is therefore always a URL this server itself signed, which is
// always one that came out of a page an author's card points at.
//
// The address guard behind `fetchImage` runs anyway. A signature is only as good as the secret, and
// this is the one route where being wrong would mean an open image proxy on a home network.

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  const sig = req.nextUrl.searchParams.get('sig');
  // 404 rather than 403 for every refusal, including a bad signature: an answer that distinguishes
  // "wrong signature" from "that image is gone" tells a prober which URLs this site knows about.
  if (!url || !sig || !verifyImageUrl(url, sig)) return new NextResponse(null, { status: 404 });

  const image = await loadImage(url);
  if (!image) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.contentType,
      // Third-party bytes served from this origin. `nosniff` is what keeps a browser from deciding
      // for itself that they are something more interesting than the type we allowed.
      'X-Content-Type-Options': 'nosniff',
      // A week, matching the row's own TTL (lib/link-previews.ts): the signed URL is stable for a
      // given target, so a reader who has seen the card once loads nothing again until then.
      //
      // **This header is advice, and the URL in it is public** — it is printed in the published
      // page, so a caller who ignores caching can ask for it as often as they like. What actually
      // bounds the outbound side is the cache and the in-flight map in lib/link-image.ts; this
      // header only spares the well-behaved. A CDN in front would take both jobs.
      'Cache-Control': 'public, max-age=604800, immutable',
    },
  });
}
