import { NextResponse, type NextRequest } from 'next/server';
import { getOptionalSession } from '@/lib/dal';
import { linkImageSrc } from '@/lib/link-image';
import { resolveLinkPreview } from '@/lib/link-previews';
import { siteOrigin } from '@/lib/site';

// What an external link card shows (docs/link-card-requirements.md §14.5). The editor's NodeView
// asks this every time it draws a card; `lib/link-previews.ts` decides whether that means a SELECT
// or a fetch, and `lib/link-title.ts` holds the fetch and the address guard.
//
// **The published page never calls this.** It reads the same table directly and cannot fetch
// (§14.1) — which is what keeps a reader's request off other people's servers.
//
// Admin-only, like every other route the editor calls. **That gate is not the whole answer to
// "this makes the server fetch a URL its caller chose", and it is worth being exact about why.**
// The session cookie is `sameSite: 'lax'`, which stops a cross-site page from calling this with
// credentials from script or from a subresource — but NOT from a top-level GET navigation, which
// is what lax deliberately allows. A page the author visits can therefore point their browser here
// with any `url` it likes and the request arrives authenticated.
//
// What that buys an attacker is bounded, and each bound is deliberate: the answer is JSON in the
// author's own tab, which the page that sent them cannot read (same-origin policy); the address
// guard in lib/link-title.ts decides what may be fetched, so it cannot be aimed at anything on the
// private network; and the body is capped and the request timed out. What is left is an outbound
// GET to a public URL of the attacker's choosing and one row in `link_previews`.
//
// **So the address guard is load-bearing here, not belt-and-braces.** Tightening the entry further
// (rejecting `sec-fetch-site: cross-site`) would close the navigation door, and would want doing
// for /api/link-title and /api/posts/search at the same time — those share this shape.

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
  // The same allowlist the resolve stage applies to a stored reference (§14.2, CARD_HREF in
  // lib/rehype-link-card.ts). Asked here as well so a card that could never be published as a card
  // does not get a row in the table on the way.
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return NextResponse.json({ preview: null });
  }

  // A link to this blog is never fetched — the server would be asking for its own public URL back
  // through the Funnel. `/api/link-title` refuses the same request for the same reason, and the
  // comparison is against the Host the browser actually addressed rather than `req.nextUrl.origin`,
  // which normalises (measured 2026-08-16: `localhost` reported for a request sent to `127.0.0.1`).
  //
  // There is no `ownTitle` fallback here, unlike that route. A card pointing at this blog is an
  // internal card, and both entry points rewrite an own-origin `/posts/…` URL into the `/posts/…`
  // reference before a card is ever made (§14.5.1) — so what reaches this line is an own-origin URL
  // that does NOT name a post, and there is no card for it to become.
  if (target.host === req.headers.get('host') || target.origin === siteOrigin.origin) {
    return NextResponse.json({ preview: null });
  }

  const preview = await resolveLinkPreview(target.toString());
  // The image leaves as the signed proxy path, not as the target's URL. The editor draws the same
  // `<img src>` the published page does, which is what §7 means by the NodeView being the real
  // card — and it means the raw third-party URL has no reason to reach a browser at all.
  return NextResponse.json({
    preview: preview && { ...preview, image: preview.image ? linkImageSrc(preview.image) : '' },
  });
}
