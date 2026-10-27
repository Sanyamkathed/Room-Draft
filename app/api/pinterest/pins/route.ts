import { NextResponse, type NextRequest } from "next/server";
import {
  PinterestError,
  pinterestConfig,
  pinterestGet,
  toFeedPin,
  type FeedPin,
  type Paged,
  type RawPin,
} from "@/lib/server/pinterest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = "50";

/**
 * GET /api/pinterest/pins?board=&q=&bookmark=
 *
 *   board — Pins on one of the person's boards
 *   q     — search: all of Pinterest when the app has the beta, else their own Pins
 *   none  — every Pin the person has saved
 *
 * Responds { pins, bookmark, scope } where scope says what was searched, so
 * the page can tell the person honestly whose Pins they are looking at.
 */
export async function GET(req: NextRequest) {
  const cfg = pinterestConfig();
  if (!cfg) return NextResponse.json({ error: "Pinterest isn't set up on this site yet." }, { status: 503 });

  const sp = req.nextUrl.searchParams;
  const board = sp.get("board")?.trim();
  const q = sp.get("q")?.trim().slice(0, 80);
  const bookmark = sp.get("bookmark") ?? undefined;

  if (board && !/^[0-9A-Za-z_-]{1,64}$/.test(board)) {
    return NextResponse.json({ error: "That board id isn't valid." }, { status: 400 });
  }

  try {
    let data: Paged<RawPin>;
    let scope: "board" | "pinterest" | "yours" = "yours";

    if (board) {
      data = await pinterestGet(cfg, `/boards/${board}/pins`, { page_size: PAGE, bookmark });
      scope = "board";
    } else if (q) {
      try {
        data = await pinterestGet(cfg, "/search/partner/pins", {
          term: q,
          country_code: "IN",
          locale: "en-IN",
          bookmark,
        });
        scope = "pinterest";
      } catch (e) {
        // The all-of-Pinterest search is a closed beta; most apps get 403.
        if (!(e instanceof PinterestError) || e.status === 401) throw e;
        data = await pinterestGet(cfg, "/search/pins", { query: q, bookmark });
      }
    } else {
      data = await pinterestGet(cfg, "/pins", { page_size: PAGE, bookmark });
    }

    const pins = data.items.map(toFeedPin).filter((p): p is FeedPin => p !== null);
    return NextResponse.json({ pins, bookmark: data.bookmark ?? null, scope });
  } catch (e) {
    const status = e instanceof PinterestError ? e.status : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't load Pins." }, { status });
  }
}
