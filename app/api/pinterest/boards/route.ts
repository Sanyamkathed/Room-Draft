import { NextResponse } from "next/server";
import {
  PinterestError,
  pinterestConfig,
  pinterestGet,
  type Paged,
  type RawBoard,
} from "@/lib/server/pinterest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/pinterest/boards — the connected person's boards, for the board picker. */
export async function GET() {
  const cfg = pinterestConfig();
  if (!cfg) return NextResponse.json({ error: "Pinterest isn't set up on this site yet." }, { status: 503 });
  try {
    const data = await pinterestGet<Paged<RawBoard>>(cfg, "/boards", { page_size: "100" });
    return NextResponse.json({
      boards: data.items.map((b) => ({
        id: b.id,
        name: b.name,
        count: b.pin_count ?? null,
        cover: b.media?.image_cover_url ?? null,
      })),
    });
  } catch (e) {
    const status = e instanceof PinterestError ? e.status : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't load boards." }, { status });
  }
}
