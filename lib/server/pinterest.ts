import { cookies } from "next/headers";

/**
 * Pinterest API v5, server side.
 *
 * What the API allows: an app reads the boards and Pins of the person who
 * connected their account (scopes boards:read, pins:read). Searching all of
 * Pinterest is a closed beta ("search/partner/pins"); we try it and fall back
 * to searching the person's own Pins when the app doesn't have it.
 *
 * Tokens live only in httpOnly cookies on this site — the browser never sees
 * them and nothing is stored server-side.
 */

const API = "https://api.pinterest.com/v5";
export const AUTHORIZE_URL = "https://www.pinterest.com/oauth/";
export const SCOPES = ["boards:read", "pins:read", "user_accounts:read"];

export const TOKEN_COOKIE = "rd_pin_token";
export const REFRESH_COOKIE = "rd_pin_refresh";
export const STATE_COOKIE = "rd_pin_state";

export interface PinterestConfig {
  appId: string;
  appSecret: string;
}

/** Null until PINTEREST_APP_ID and PINTEREST_APP_SECRET are set. */
export function pinterestConfig(): PinterestConfig | null {
  const appId = process.env.PINTEREST_APP_ID?.trim();
  const appSecret = process.env.PINTEREST_APP_SECRET?.trim();
  return appId && appSecret ? { appId, appSecret } : null;
}

/**
 * The OAuth redirect. It must match one registered on the Pinterest app
 * exactly, so an explicit PINTEREST_REDIRECT_URI wins over the request origin.
 */
export function redirectUri(origin: string): string {
  return process.env.PINTEREST_REDIRECT_URI?.trim() || `${origin}/api/pinterest/callback`;
}

export const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

/* ---------------- tokens ---------------- */

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
}

async function tokenRequest(cfg: PinterestConfig, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.appId}:${cfg.appSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  if (!res.ok) throw new PinterestError(res.status, "Pinterest didn't accept the sign-in.");
  return (await res.json()) as TokenResponse;
}

export function exchangeCode(cfg: PinterestConfig, code: string, redirect: string) {
  return tokenRequest(cfg, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
    continuous_refresh: "true",
  });
}

export async function storeTokens(t: TokenResponse) {
  const jar = await cookies();
  jar.set(TOKEN_COOKIE, t.access_token, { ...cookieBase, maxAge: t.expires_in ?? 60 * 60 * 24 * 30 });
  if (t.refresh_token) {
    jar.set(REFRESH_COOKIE, t.refresh_token, {
      ...cookieBase,
      maxAge: t.refresh_token_expires_in ?? 60 * 60 * 24 * 60,
    });
  }
}

export async function clearTokens() {
  const jar = await cookies();
  jar.delete(TOKEN_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

/** The access token, refreshed when it has lapsed but the refresh token hasn't. */
async function accessToken(cfg: PinterestConfig): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(TOKEN_COOKIE)?.value;
  if (token) return token;
  const refresh = jar.get(REFRESH_COOKIE)?.value;
  if (!refresh) return null;
  try {
    const t = await tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refresh });
    await storeTokens(t);
    return t.access_token;
  } catch {
    await clearTokens();
    return null;
  }
}

export async function isConnected(): Promise<boolean> {
  const jar = await cookies();
  return Boolean(jar.get(TOKEN_COOKIE)?.value || jar.get(REFRESH_COOKIE)?.value);
}

/* ---------------- API calls ---------------- */

export class PinterestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function pinterestGet<T>(cfg: PinterestConfig, path: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const token = await accessToken(cfg);
  if (!token) throw new PinterestError(401, "Connect your Pinterest account first.");
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 401) {
    await clearTokens();
    throw new PinterestError(401, "Your Pinterest connection expired. Connect again.");
  }
  if (!res.ok) throw new PinterestError(res.status, "Pinterest couldn't load that right now.");
  return (await res.json()) as T;
}

/* ---------------- shapes ---------------- */

type ImageSet = Record<string, { url?: string; width?: number; height?: number } | undefined>;

export interface RawPin {
  id: string;
  title?: string | null;
  description?: string | null;
  link?: string | null;
  dominant_color?: string | null;
  media?: {
    media_type?: string;
    images?: ImageSet;
    cover_image_url?: string;
    items?: { images?: ImageSet }[];
  };
}

export interface RawBoard {
  id: string;
  name: string;
  pin_count?: number;
  media?: { image_cover_url?: string | null };
}

export interface Paged<T> {
  items: T[];
  bookmark?: string | null;
}

/** What the inspo feed renders: one image per Pin, sized for a masonry column. */
export interface FeedPin {
  id: string;
  title: string;
  image: string;
  /** Full-size image, handed to the import step when the Pin goes into a room. */
  full: string;
  width: number;
  height: number;
  color: string | null;
  pinUrl: string;
}

function pickImages(m: RawPin["media"]): ImageSet | undefined {
  if (!m) return undefined;
  if (m.images) return m.images;
  return m.items?.find((i) => i.images)?.images;
}

export function toFeedPin(p: RawPin): FeedPin | null {
  const images = pickImages(p.media);
  const show = images?.["600x"] ?? images?.["400x300"] ?? images?.["1200x"];
  const full = images?.["1200x"] ?? images?.originals ?? show;
  const url = show?.url ?? p.media?.cover_image_url;
  if (!url) return null;
  return {
    id: p.id,
    title: (p.title || p.description || "Pinterest idea").replace(/\s+/g, " ").trim().slice(0, 120),
    image: url,
    full: full?.url ?? url,
    width: show?.width ?? 600,
    height: show?.height ?? 800,
    color: p.dominant_color ?? null,
    pinUrl: `https://www.pinterest.com/pin/${encodeURIComponent(p.id)}/`,
  };
}
