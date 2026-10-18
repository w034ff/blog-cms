import { NextResponse, type NextRequest } from 'next/server';
import { decryptSession, encryptSession, SESSION_MAX_AGE_SECONDS } from '@/lib/session-token';

const SESSION_COOKIE = 'session';

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await decryptSession(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith('/admin') && !session) {
    return NextResponse.redirect(new URL('/login', req.nextUrl));
  }

  const res = NextResponse.next();
  // Not on a Server Action (`Next-Action` header). Next merges a proxy's Set-Cookie into the
  // action's own cookie store, and a modified cookie counts as a revalidation: every publish came
  // back with the whole page re-rendered for the address bar's URL. On a post begun at
  // /admin/posts/new, whose URL autosave rewrites to /edit, that swapped in the edit page and
  // remounted the editor — a refused publish lost its message (docs/editor-requirements.md
  // §12.27). Page loads still slide the window.
  if (session && !req.headers.has('next-action')) {
    // Sliding session: extend the 14-day window on each authenticated request.
    const refreshed = await encryptSession(session);
    res.cookies.set(SESSION_COOKIE, refreshed, {
      httpOnly: true,
      // Same rule as lib/session.ts's cookieSecure, read directly rather than
      // imported: that module is server-only and pulls in next/headers, neither of
      // which belongs in the proxy. The two must stay in step — this is the
      // refresh of the cookie that one issues.
      secure: process.env.SESSION_COOKIE_SECURE === 'true',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: '/',
    });
  }
  return res;
}

// /login is not here: sending a signed-in visitor on to /admin needs the database's answer, which
// only the page has. A token alone also passes for a suspended author, whom /admin sends back to
// /login, and the two redirects would loop (docs/multi-author-requirements.md §5).
export const config = {
  matcher: ['/admin/:path*'],
};
