import { NextResponse } from "next/server";
import { isConnected, pinterestConfig } from "@/lib/server/pinterest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/pinterest/status — whether the app is set up, and whether this browser is connected. */
export async function GET() {
  const configured = Boolean(pinterestConfig());
  return NextResponse.json({ configured, connected: configured && (await isConnected()) });
}
