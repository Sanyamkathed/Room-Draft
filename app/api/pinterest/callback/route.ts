import { NextResponse, type NextRequest } from "next/server";
import {
  STATE_COOKIE,
  exchangeCode,
  pinterestConfig,
  redirectUri,
  storeTokens,
} from "@/lib/server/pinterest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/pinterest/callback — Pinterest sends the person back here with a one-time code. */
export async function GET(req: NextRequest) {
  const back = (error?: string) =>
    NextResponse.redirect(new URL(error ? `/inspo?error=${error}` : "/inspo", req.url));

  const cfg = pinterestConfig();
  if (!cfg) return back("setup");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = req.cookies.get(STATE_COOKIE)?.value;
  if (!code) return back("denied");
  if (!state || !expected || state !== expected) return back("state");

  try {
    await storeTokens(await exchangeCode(cfg, code, redirectUri(req.nextUrl.origin)));
  } catch {
    return back("token");
  }
  const res = back();
  res.cookies.delete(STATE_COOKIE);
  return res;
}
