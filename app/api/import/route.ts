import { NextResponse } from "next/server";
import { FetchRefused, safeGet } from "@/lib/server/safeFetch";

/**
 * POST /api/import  { url }  →  { title, image, site, sourceUrl }
 *
 * Turns a pasted link — a Pinterest pin, an Amazon/IKEA/Etsy listing, any
 * page with a product image, or a direct image link — into the raw material
 * for a user-made decor item: the main image (as a data URL) and a title.
 * Prices are deliberately not read — user items are for visualising decor,
 * not for selling.
 *
 * Runs on the server only because browsers can't read other sites' pages.
 * Everything it returns is untrusted: text is stripped to plain characters,
 * and the image is only accepted if its bytes really are JPEG/PNG/WEBP/GIF —
 * then the browser re-draws it onto a canvas before use, so only pixels
 * survive (no SVG, no scripts, no metadata). Nothing is stored here.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAGE = 2_500_000;
const MAX_IMAGE = 8_000_000;

/* ---------------- tiny per-client rate limit ---------------- */

const hits = new Map<string, number[]>();
function limited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 20;
}

/* ---------------- parsing ---------------- */

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Plain text only, one line, bounded. */
function cleanText(raw: unknown, max = 120): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = decodeEntities(raw.replace(/<[^>]*>/g, " "))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : undefined;
}

function metaContent(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${key.replace(/[:.]/g, "\\$&")}["'][^>]*>`,
      "i",
    );
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content) return decodeEntities(content);
  }
  return undefined;
}

interface Found {
  title?: string;
  image?: string;
}

/** schema.org Product data (name and image), which most shops embed. */
function fromJsonLd(html: string): Found {
  const out: Found = {};
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object" || out.image) return;
    if (Array.isArray(node)) return node.forEach(visit);
    const o = node as Record<string, unknown>;
    if (o["@graph"]) visit(o["@graph"]);
    const type = o["@type"];
    const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
    if (isProduct) {
      out.title ??= cleanText(o.name);
      const img = o.image;
      const first = Array.isArray(img) ? img[0] : img;
      out.image ??= typeof first === "string" ? first : (first as { url?: string })?.url;
    }
  };
  for (const b of blocks) {
    try {
      visit(JSON.parse(b.replace(/^<script[^>]*>|<\/script>$/gi, "")));
    } catch {
      /* malformed blocks are common; skip them */
    }
  }
  return out;
}

function parsePage(html: string, base: URL): Found {
  const ld = fromJsonLd(html);
  const image =
    ld.image ??
    metaContent(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src", "image"]);
  const title =
    ld.title ??
    cleanText(metaContent(html, ["og:title", "twitter:title"])) ??
    cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  let resolved: string | undefined;
  try {
    resolved = image ? new URL(image, base).toString() : undefined;
  } catch {
    resolved = undefined;
  }
  return { title, image: resolved };
}

/** Trust the bytes, not the Content-Type header. */
function sniffImage(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (b.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  return null;
}

function siteName(u: URL): string {
  const host = u.hostname.replace(/^www\./, "");
  if (/(^|\.)pinterest\.[a-z.]+$|^pin\.it$/.test(host)) return "Pinterest";
  if (/(^|\.)amazon\.[a-z.]+$|^amzn\.[a-z]+$/.test(host)) return "Amazon";
  if (/(^|\.)ikea\.com$/.test(host)) return "IKEA";
  if (/(^|\.)etsy\.com$/.test(host)) return "Etsy";
  if (/(^|\.)flipkart\.com$/.test(host)) return "Flipkart";
  return host.slice(0, 40);
}

/* ---------------- handler ---------------- */

export async function POST(req: Request) {
  const client = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(client)) {
    return NextResponse.json({ error: "Too many imports at once — wait a minute and try again." }, { status: 429 });
  }

  let url: string;
  try {
    const body = (await req.json()) as { url?: unknown };
    url = typeof body.url === "string" ? body.url.trim().slice(0, 2048) : "";
  } catch {
    return NextResponse.json({ error: "Send a link to import." }, { status: 400 });
  }
  if (!url) return NextResponse.json({ error: "Paste a link first." }, { status: 400 });

  try {
    const page = await safeGet(url, {
      maxBytes: MAX_PAGE,
      accept: "text/html,application/xhtml+xml,image/avif,image/webp,image/*;q=0.9,*/*;q=0.5",
    });
    if (page.status === 429) {
      return NextResponse.json({ error: "That site is limiting requests right now — try again in a minute." }, { status: 502 });
    }
    if (page.status >= 400) {
      return NextResponse.json({ error: `That site answered with an error (${page.status}).` }, { status: 502 });
    }

    // A direct image link needs no page parsing.
    let found: Found = {};
    let imageBytes: Buffer | null = null;
    if (sniffImage(page.body)) {
      imageBytes = page.body;
    } else {
      found = parsePage(page.body.toString("utf8"), page.url);
      if (!found.image) {
        return NextResponse.json(
          { error: "Couldn't find a product image on that page. Try saving the image and uploading it instead." },
          { status: 422 },
        );
      }
      const img = await safeGet(found.image, { maxBytes: MAX_IMAGE, accept: "image/avif,image/webp,image/*,*/*;q=0.5" });
      if (img.status === 429) {
        return NextResponse.json({ error: "That site is limiting requests right now — try again in a minute." }, { status: 502 });
      }
      if (img.status >= 400) {
        return NextResponse.json({ error: "Found an image but couldn't download it." }, { status: 502 });
      }
      imageBytes = img.body;
    }

    const mime = sniffImage(imageBytes);
    if (!mime) {
      return NextResponse.json({ error: "That link's image isn't a JPEG, PNG, WEBP or GIF." }, { status: 415 });
    }

    return NextResponse.json({
      title: found.title,
      site: siteName(page.url),
      sourceUrl: page.url.toString(),
      image: `data:${mime};base64,${imageBytes.toString("base64")}`,
    });
  } catch (e) {
    const message = e instanceof FetchRefused ? e.message : "Couldn't import that link.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
