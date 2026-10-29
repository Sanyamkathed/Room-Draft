import { NextResponse, type NextRequest } from "next/server";
import {
  PinterestError,
  pinterestConfig,
  pinterestGet,
  toFeedPin,
  type PinterestConfig,
  type FeedPin,
  type Paged,
  type RawPin,
} from "@/lib/server/pinterest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = "50";
/** How many of the person's Pins a search looks through. */
const SEARCH_PAGES = 4;

/** Every word of the query appears in the Pin's title, description or alt text. */
async function searchOwnPins(cfg: PinterestConfig, q: string): Promise<RawPin[]> {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found: RawPin[] = [];
  let bookmark: string | undefined;
  for (let page = 0; page < SEARCH_PAGES; page++) {
    const data = await pinterestGet<Paged<RawPin>>(cfg, "/pins", { page_size: "100", bookmark });
    for (const pin of data.items) {
      const hay = [pin.title, pin.description, pin.alt_text].filter(Boolean).join(" ").toLowerCase();
      if (words.every((w) => hay.includes(w))) found.push(pin);
    }
    if (!data.bookmark) break;
    bookmark = data.bookmark;
  }
  return found;
}

/**
 * GET /api/pinterest/pins?board=&q=&bookmark=
 *
 *   board — Pins on one of the person's boards
 *   q     — search; mode=mine (default) searches the person's own Pins,
 *           mode=all searches all of Pinterest when the app has the partner
 *           beta, else answers { available: false }
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
  const mode = sp.get("mode") === "all" ? "all" : "mine";

  if (board && !/^[0-9A-Za-z_-]{1,64}$/.test(board)) {
    return NextResponse.json({ error: "That board id isn't valid." }, { status: 400 });
  }

  try {
    let data: Paged<RawPin>;
    let scope: "board" | "pinterest" | "yours" = "yours";

    if (board) {
      data = await pinterestGet(cfg, `/boards/${board}/pins`, { page_size: PAGE, bookmark });
      scope = "board";
    } else if (q && mode === "all") {
      // All of Pinterest needs the partner search, a closed beta. Without it
      // the page offers a search on Pinterest itself instead.
      try {
        data = await pinterestGet(
          cfg,
          "/search/partner/pins",
          { term: q, country_code: "IN", locale: "en-IN", bookmark },
          { optional: true },
        );
        scope = "pinterest";
      } catch (e) {
        if (e instanceof PinterestError && e.status === 401) throw e;
        return NextResponse.json({ pins: [], bookmark: null, scope: "pinterest", available: false });
      }
    } else if (q) {
      // The person's own Pins. Pinterest's "search my Pins" needs the
      // secret-board scopes, which we don't ask for, so we search them here.
      data = { items: await searchOwnPins(cfg, q), bookmark: null };
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
