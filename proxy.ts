import { NextResponse, type NextRequest } from "next/server";
import {
  decryptSession,
  encryptSession,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/session-token";

const SESSION_COOKIE = "session";

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await decryptSession(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith("/admin") && !session) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (pathname === "/login" && session) {
    return NextResponse.redirect(new URL("/admin", req.nextUrl));
  }

  const res = NextResponse.next();
  if (session) {
    // Sliding session: extend the 14-day window on each authenticated request.
    const refreshed = await encryptSession(session);
    res.cookies.set(SESSION_COOKIE, refreshed, {
      httpOnly: true,
      secure: process.env.SESSION_COOKIE_SECURE === "true",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
    });
  }
  return res;
}

export const config = {
  matcher: ["/admin/:path*", "/login"],
};
