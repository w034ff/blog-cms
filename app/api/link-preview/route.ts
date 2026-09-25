import { NextResponse, type NextRequest } from 'next/server';
import { getOptionalSession } from '@/lib/dal';
import { linkImageSrc } from '@/lib/link-image';
import { resolveLinkPreview } from '@/lib/link-previews';
import { isOwnOrigin } from '@/lib/site';

// What an external link card shows (docs/link-card-requirements.md §14.5). The published page never
// calls this (§14.1); `lib/link-previews.ts` decides between a SELECT and a fetch.
//
// **The admin gate does not stop a cross-site top-level GET** (`sameSite: 'lax'` lets it through),
// so the address guard in lib/link-title.ts is load-bearing here (§14.5.2).

export async function GET(req: NextRequest) {
  if (!(await getOptionalSession())) {
    return new NextResponse(null, { status: 401 });
  }

  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) return NextResponse.json({ error: 'url is required' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ preview: null });
  }
  // Same allowlist as CARD_HREF (lib/rehype-link-card.ts, §14.2): no row for a card that could never
  // be published as one.
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return NextResponse.json({ preview: null });
  }

  // Never fetch this blog's own URL (a loop through the Funnel). No `ownTitle` fallback, unlike
  // /api/link-title: an own-origin `/posts/…` URL is rewritten into an internal card before this
  // (§14.5.1), so what reaches here names no post.
  if (isOwnOrigin(target, req.headers.get('host'))) {
    return NextResponse.json({ preview: null });
  }

  // The explicit 「カードにする」 re-asks past a remembered failure (§14.3.2).
  const force = req.nextUrl.searchParams.get('force') === '1';

  const preview = await resolveLinkPreview(target.toString(), force);
  // The image leaves as the signed proxy path, the same `<img src>` the published page draws (§7), so
  // the third-party URL never reaches a browser.
  return NextResponse.json({
    preview: preview && { ...preview, image: preview.image ? linkImageSrc(preview.image) : '' },
  });
}
