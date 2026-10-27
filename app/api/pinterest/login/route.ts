import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import {
  AUTHORIZE_URL,
  SCOPES,
  STATE_COOKIE,
  cookieBase,
  pinterestConfig,
  redirectUri,
} from "@/lib/server/pinterest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/pinterest/login — send the person to Pinterest to approve read access. */
export async function GET(req: NextRequest) {
  const cfg = pinterestConfig();
  if (!cfg) return NextResponse.redirect(new URL("/inspo?error=setup", req.url));

  const state = randomBytes(16).toString("hex");
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("redirect_uri", redirectUri(req.nextUrl.origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(","));
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, { ...cookieBase, maxAge: 600 });
  return res;
}
