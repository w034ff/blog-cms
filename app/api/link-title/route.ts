import { NextResponse, type NextRequest } from 'next/server';
import { getOptionalSession } from '@/lib/dal';
import { fetchLinkTitle, normalizeTitle } from '@/lib/link-title';
import { getPostBySlug } from '@/lib/posts';
import { siteOrigin } from '@/lib/site';

// The title for the card's top line (docs/link-requirements.md §5.5.10). `lib/link-title.ts` holds
// the fetch and the address guard; this is the gate, the cache and the own-link case. The admin gate
// does not stop a cross-site top-level GET, so the guard is load-bearing
// (docs/link-card-requirements.md §14.5.2).

// A caret lands on the same link many times a minute, and a server fetch gets no browser cache.
// Failures (typically Cloudflare challenges) are cached too, for less time: they fail fast, but are
// likelier to clear than a title is to change.
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
  // Insertion-ordered: the first key is the oldest.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { title, expires: Date.now() + (title === null ? FAIL_TTL_MS : OK_TTL_MS) });
}

// Answered from the database, never fetched: the server would request its own URL back through the
// Funnel, the one request the address guard cannot reason about.
async function ownTitle(target: URL): Promise<string | null> {
  const slug = /^\/posts\/([^/]+)\/?$/.exec(target.pathname)?.[1];
  if (!slug) return null;
  // A malformed escape (`%zz`) makes `decodeURIComponent` throw, and `new URL()` leaves one in the
  // pathname. Same guard, same reason as normalizeCardHref (lib/link-card-href.ts): it names no
  // post, so it is a miss rather than a 500.
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const post = await getPostBySlug(decoded);
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

  // Own link? Compared against the Host the browser addressed: `req.nextUrl.origin` normalises
  // (`localhost` for `127.0.0.1`), which would make every internal link external and refused as
  // loopback. `SITE_ORIGIN` covers a pasted published URL while working locally.
  const isOwn = target.host === req.headers.get('host') || target.origin === siteOrigin.origin;
  const title = isOwn ? await ownTitle(target) : await fetchLinkTitle(target.toString());
  remember(key, title);
  return NextResponse.json({ title });
}
