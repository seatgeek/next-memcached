import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * GET /api/session        -> sets a fresh demo-session cookie, redirects to /
 * GET /api/session?clear=1 -> clears the cookie (ends the session)
 *
 * The session id is passed as an ARGUMENT into the private `'use cache'`
 * fragment, so it becomes part of the cache key — each browser session gets
 * its own independently cached (and independently frozen) entry.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const response = NextResponse.redirect(new URL("/", url));

  if (url.searchParams.get("clear")) {
    response.cookies.delete("demo-session");
    return response;
  }

  response.cookies.set("demo-session", randomUUID().slice(0, 8), {
    path: "/",
    sameSite: "lax",
  });
  return response;
}
