import { NextResponse, type NextRequest } from 'next/server';
import { GOOGLE_AUTH_COOKIE, googleAuthCookieDeletion } from '@/lib/google-auth-cookie';
import { signInWithGoogle, type GoogleSignIn } from '@/lib/google-login';
import {
  decodeAuthRequest,
  exchangeCode,
  googleClient,
  verifyIdToken,
  type GoogleClient,
} from '@/lib/google-oidc';
import { createSession } from '@/lib/session';
import { siteOrigin } from '@/lib/site';

// Where Google sends the browser back (docs/multi-author-requirements.md §9.3, steps 2-5). Every
// outcome ends at a redirect: /admin when signed in, else /login with the reason.
export async function GET(request: NextRequest): Promise<Response> {
  const client = googleClient();
  if (!client) return new Response(null, { status: 404 });

  const result = await complete(client, request);
  if (result.ok) {
    await createSession({ userId: result.userId });
  } else {
    // The only record that a sign-in was refused; the reason alone, no address.
    console.warn(`google sign-in refused: ${result.reason}`);
  }
  const target = result.ok ? '/admin' : `/login?error=${result.reason}`;
  const response = NextResponse.redirect(new URL(target, siteOrigin));
  response.cookies.delete(googleAuthCookieDeletion);
  return response;
}

async function complete(client: GoogleClient, request: NextRequest): Promise<GoogleSignIn> {
  const saved = decodeAuthRequest(request.cookies.get(GOOGLE_AUTH_COOKIE)?.value);
  const params = request.nextUrl.searchParams;
  const code = params.get('code');
  // A missing cookie, a state from another tab, or Google answering `error=access_denied` when the
  // person cancels all land here.
  if (!saved || params.get('state') !== saved.state || !code)
    return { ok: false, reason: 'failed' };

  let idToken: string;
  try {
    idToken = await exchangeCode(client, code, saved.codeVerifier);
  } catch {
    return { ok: false, reason: 'failed' };
  }
  const verified = await verifyIdToken(idToken, { clientId: client.clientId, nonce: saved.nonce });
  if (!verified.ok) return verified;
  return signInWithGoogle(verified.claims);
}
