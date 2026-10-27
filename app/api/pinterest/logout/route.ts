import { NextResponse } from "next/server";
import { clearTokens } from "@/lib/server/pinterest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/pinterest/logout — forget the Pinterest connection on this browser. */
export async function POST() {
  await clearTokens();
  return NextResponse.json({ ok: true });
}
