import { NextResponse } from 'next/server';
import { getOptionalSession } from '@/lib/dal';
import { GOOGLE_AUTH_COOKIE, googleAuthCookieOptions } from '@/lib/google-auth-cookie';
import {
  authorizationUrl,
  encodeAuthRequest,
  googleClient,
  newAuthRequest,
} from '@/lib/google-oidc';
import { siteOrigin } from '@/lib/site';

// Starts a Google sign-in (docs/multi-author-requirements.md §9.3, step 1). A 404 where no OAuth
// client is configured, so the route does not exist rather than failing at Google.
export async function GET(): Promise<Response> {
  const client = googleClient();
  if (!client) return new Response(null, { status: 404 });
  if (await getOptionalSession()) return NextResponse.redirect(new URL('/admin', siteOrigin));

  const request = newAuthRequest();
  const response = NextResponse.redirect(authorizationUrl(client, request));
  response.cookies.set(GOOGLE_AUTH_COOKIE, encodeAuthRequest(request), googleAuthCookieOptions);
  return response;
}
