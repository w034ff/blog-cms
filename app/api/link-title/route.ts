import { NextResponse, type NextRequest } from 'next/server';
import { getOptionalSession } from '@/lib/dal';
import { fetchLinkTitle, normalizeTitle } from '@/lib/link-title';
import { getPostBySlug } from '@/lib/posts';
import { siteOrigin } from '@/lib/site';

// The title of the page a link points at, for the card's top line (docs/link-requirements.md
// §5.5.10). `lib/link-title.ts` holds the fetch and the address guard; this is the gate, the cache
// and the one case that must not be fetched at all.
//
// Admin-only, like every other route the editor calls. That gate is also most of the answer to
// "this endpoint makes the server fetch a URL its caller chose": the only caller is the author,
// who already has more power over this server than the route grants, and the session cookie is
// `sameSite: 'lax'`, so a cross-site page cannot make the author's browser call it either. The
// address guard exists anyway, because "the only user is trusted" stops being true the day a
// credential leaks, and the server sits on a home network behind Tailscale Funnel.

// Titles change rarely and a caret can land on the same link many times a minute. A server fetch
// gets none of the browser caching the favicon leans on, so the cache is here.
//
// Failures are cached too, and that is not symmetry for its own sake: the measured failures are
// Cloudflare challenges, which fail fast and would otherwise be re-fetched on every caret
// placement into that link. Shorter, because a 403 is more likely to stop being true than a title
// is to change.
const OK_TTL_MS = 6 * 60 * 60 * 1000;
const FAIL_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;

const cache = new Map<string, { title: string | null; expires: number }>();

function cached(key: string): { title: string | null } | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return { title: hit.title };
}

function remember(key: string, title: string | null): void {
  // Insertion-ordered, so the oldest key is the first one — enough of an eviction policy for a
  // map that exists to spare a handful of repeat fetches.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { title, expires: Date.now() + (title === null ? FAIL_TTL_MS : OK_TTL_MS) });
}

// A link to this blog is answered from the database, never fetched. That is a security property
// rather than a shortcut: fetching it would have the server request its own public URL back
// through the Funnel, which is a loop waiting to happen and the one request the address guard
// cannot reason about.
async function ownTitle(target: URL): Promise<string | null> {
  const slug = /^\/posts\/([^/]+)\/?$/.exec(target.pathname)?.[1];
  if (!slug) return null;
  const post = await getPostBySlug(decodeURIComponent(slug));
  return post ? normalizeTitle(post.title) : null;
}

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
    return NextResponse.json({ title: null });
  }

  const key = target.toString();
  const hit = cached(key);
  if (hit) return NextResponse.json(hit);

  // "Is this a link to us?" is answered against the Host the browser actually addressed, not
  // against `req.nextUrl.origin`. The client builds the URL from `window.location.origin`, so its
  // host is by construction the one the request carries — while `nextUrl` normalises, and measured
  // 2026-08-16 it reported `localhost` for a request the browser sent to `127.0.0.1`. The two then
  // disagree, the link counts as external, and the guard refuses it as loopback: no internal link
  // shows a title anywhere. `SITE_ORIGIN` is checked as well, for the author who pastes a full
  // published URL while working locally.
  const isOwn = target.host === req.headers.get('host') || target.origin === siteOrigin.origin;
  const title = isOwn ? await ownTitle(target) : await fetchLinkTitle(target.toString());
  remember(key, title);
  return NextResponse.json({ title });
}
