/**
 * Client for the room-analysis service (backend/).
 *
 * The service is **optional**. It is a Python process with model weights, it
 * may not be running, and the app has to work anyway — so every entry point
 * here resolves to a discriminated result rather than throwing, and the
 * caller falls back to the guided perspective fit that was always the
 * primary path. "AI unavailable" should cost the user one extra screen, not
 * the feature.
 *
 * What comes back is a *proposal*: a calibration whose four corners the user
 * can still drag, and a list of furniture they can accept or delete. The
 * service is deliberately not allowed to be the last word on anything.
 */

import type { Quad, RoomCalibration, SurfaceId, Vec2, Vec3 } from "@/lib/room/types";

export const CV_ENDPOINT =
  process.env.NEXT_PUBLIC_CV_ENDPOINT?.replace(/\/$/, "") ?? "http://localhost:8000";

/* ------------------------------------------------------------------ */
/* Wire types — mirror backend/app/schemas.py                          */
/* ------------------------------------------------------------------ */

/**
 * How a dimension was arrived at.
 *
 *   plane   — two opposing surfaces were fitted and the gap measured
 *   extent  — only the visible points bounded it, so it is a LOWER bound
 *   default — it could not be determined at all
 */
export type MeasuredFrom = "plane" | "extent" | "default";

export interface CvDimensions {
  width: number;
  height: number;
  depth: number;
  backWallDistance: number;
  measuredFrom: Record<"width" | "height" | "depth", MeasuredFrom>;
}

export interface CvSurfaceView {
  quad: Quad;
  /** All four corners are in front of the camera, so the quad is usable. */
  visible: boolean;
  /** Fraction of corners inside the photo. A floor is rarely wholly in shot. */
  framed: number;
  behindCamera: number;
}

export interface CvObject {
  label: string;
  confidence: number;
  box: [number, number, number, number];
  /** Catalogue id, or null when nothing in the catalogue represents it. */
  productId: string | null;
  mount: "wall" | "floor" | "tabletop" | "ceiling" | "edge";
  furniture: boolean;
  /** Room-local metres, the CONTACT point — same convention as PlacedItem. */
  position: Vec3;
  yaw: number;
  sizeCm: { w: number; h: number; d: number };
  /** Always true: one view cannot see how deep an object is. */
  depthFromPrior: boolean;
  againstWall: SurfaceId | null;
  distance: number;
}

export interface CvQuality {
  confidence: number;
  method: "manhattan" | "level" | "partial" | "fallback";
  anchor: "floor" | "ceiling" | "none";
  planes: number;
  manhattan: number | null;
  floorInliers: number;
  depthModel: string;
  detectModel: string | null;
  warnings: string[];
}

export interface CvAnalysis {
  ok: boolean;
  image: { width: number; height: number };
  calibration: RoomCalibration;
  dimensions: CvDimensions;
  surfaces: Partial<Record<SurfaceId, CvSurfaceView>>;
  objects: CvObject[];
  unplaced: { label: string; confidence: number; box: number[] }[];
  palette: { wall: string; floor: string; ceiling: string; accent: string };
  camera: { fovDeg: number; heightM: number; rollDeg: number };
  quality: CvQuality;
  timings: Record<string, number>;
}

export interface CvOptions {
  /** The one assumption that fixes absolute scale. Metres. */
  cameraHeight?: number;
  fovDeg?: number;
  frontExtension?: number;
  ceilingHeight?: number;
  detectConf?: number;
  detect?: boolean;
  signal?: AbortSignal;
  /**
   * Give up after this long and let the caller use its own estimate.
   *
   * The service preloads its models at startup so a warm request is ~2s, but
   * a cold one is ~35s, and the user is staring at a progress screen for
   * every one of those seconds. Waiting forever for a better answer is the
   * wrong trade when a usable answer already exists.
   */
  timeoutMs?: number;
}

export type CvResult =
  | { ok: true; analysis: CvAnalysis }
  | { ok: false; reason: CvFailure; detail: string };

/**
 * Why analysis did not happen. The distinction is what the UI says next:
 * `offline` means "start the service", `warming` means "try again shortly",
 * `rejected` means "this photo will not work, pick another", `timeout`
 * means it is running but too slow to wait for.
 */
export type CvFailure =
  | "offline"
  | "warming"
  | "rejected"
  | "aborted"
  | "timeout"
  | "error";

/* ------------------------------------------------------------------ */

/** A warm request is ~2s. This is the ceiling for a cold or struggling one. */
const DEFAULT_TIMEOUT_MS = 25_000;

const HEALTH_TTL = 15_000;
let healthCache: { at: number; ok: boolean } | null = null;

/** Is the service up? Cached briefly so a screen can ask freely. */
export async function cvAvailable(signal?: AbortSignal): Promise<boolean> {
  const now = Date.now();
  if (healthCache && now - healthCache.at < HEALTH_TTL) return healthCache.ok;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${CV_ENDPOINT}/health`, {
      signal: signal ?? controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    const ok = res.ok;
    healthCache = { at: now, ok };
    return ok;
  } catch {
    healthCache = { at: now, ok: false };
    return false;
  }
}

/** Forget the cached health, e.g. after the user says they started it. */
export function resetCvHealth(): void {
  healthCache = null;
}

/**
 * Analyse one photo.
 *
 * Never throws. A failed analysis is an ordinary outcome here, not an
 * exception — the caller's next step is the same either way: show the
 * corner-marking screen, seeded if this worked and empty if it did not.
 */
export async function analyzeRoom(
  file: Blob,
  opts: CvOptions = {},
): Promise<CvResult> {
  const params = new URLSearchParams();
  if (opts.cameraHeight != null) params.set("cameraHeight", String(opts.cameraHeight));
  if (opts.fovDeg != null) params.set("fovDeg", String(opts.fovDeg));
  if (opts.frontExtension != null) params.set("frontExtension", String(opts.frontExtension));
  if (opts.ceilingHeight != null) params.set("ceilingHeight", String(opts.ceilingHeight));
  if (opts.detectConf != null) params.set("detectConf", String(opts.detectConf));
  if (opts.detect != null) params.set("detect", String(opts.detect));

  const body = new FormData();
  body.append("image", file, "room.jpg");

  // Two reasons to abort: the caller left the screen, or we ran out of
  // patience. They need telling apart, because only one of them is worth
  // showing the user a message about.
  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onCallerAbort = () => limit.abort();
  opts.signal?.addEventListener("abort", onCallerAbort, { once: true });

  let res: Response;
  try {
    res = await fetch(`${CV_ENDPOINT}/analyze?${params}`, {
      method: "POST",
      body,
      signal: limit.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      return opts.signal?.aborted
        ? { ok: false, reason: "aborted", detail: "cancelled" }
        : { ok: false, reason: "timeout", detail: "the analysis took too long" };
    }
    return {
      ok: false,
      reason: "offline",
      detail: "the analysis service is not running",
    };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onCallerAbort);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    // 503 is the service telling us it is fine but not ready — a first-run
    // checkpoint download. Worth retrying; the others are not.
    const reason: CvFailure =
      res.status === 503 ? "warming" : res.status >= 400 && res.status < 500 ? "rejected" : "error";
    return { ok: false, reason, detail: extractDetail(detail) };
  }

  try {
    return { ok: true, analysis: (await res.json()) as CvAnalysis };
  } catch {
    return { ok: false, reason: "error", detail: "malformed response" };
  }
}

function extractDetail(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.detail === "string" ? parsed.detail : raw;
  } catch {
    return raw.slice(0, 200);
  }
}

/* ------------------------------------------------------------------ */
/* Reading the result                                                  */
/* ------------------------------------------------------------------ */

/**
 * Should this result be shown as a confident answer, or as a rough start?
 *
 * The threshold is deliberately not a single confidence number: a solve can
 * score well and still have guessed every dimension. What matters to the
 * user is whether anything was actually *measured*.
 */
export function isTrustworthy(a: CvAnalysis): boolean {
  const measured = Object.values(a.dimensions.measuredFrom).filter(
    (m) => m === "plane",
  ).length;
  return a.quality.method === "manhattan" && a.quality.confidence >= 0.6 && measured >= 2;
}

/** Human-readable notes worth putting in front of the user, worst first. */
export function advisories(a: CvAnalysis): string[] {
  const out: string[] = [];
  if (a.quality.method === "partial" || a.quality.method === "fallback") {
    out.push("Couldn't read the room's shape from this photo — check the corners below.");
  }
  if (a.quality.anchor === "ceiling") {
    out.push("The floor wasn't visible, so sizes are based on a standard ceiling height.");
  }
  if (Math.abs(a.camera.rollDeg) > 6) {
    out.push(`The photo looks tilted by about ${Math.round(Math.abs(a.camera.rollDeg))}°.`);
  }
  for (const [axis, how] of Object.entries(a.dimensions.measuredFrom)) {
    if (how === "default") out.push(`Couldn't measure the room's ${axis} — using a typical value.`);
  }
  return out.concat(a.quality.warnings.filter((w) => !out.includes(w)));
}
