"use client";

import * as React from "react";
import type { ModelKind, Product } from "@/lib/catalog/types";
import { cn } from "@/lib/utils/cn";
import { useProductRender } from "./thumbCache";

/**
 * Catalog thumbnails.
 *
 * Drawn from each product's own palette rather than shipped as images: it
 * keeps the catalog weightless, guarantees the tile agrees with what the 3D
 * model will actually look like, and means a product added later needs no art
 * pass. Emissive products get a real glow so the lighting category reads as
 * lighting at a glance.
 */

type Glyph =
  | "flat"
  | "neon"
  | "run"
  | "disc"
  | "shelf"
  | "lamp"
  | "plant"
  | "vessel"
  | "figure"
  | "books"
  | "stand"
  | "blob"
  | "box"
  | "bedGlyph"
  | "opening"
  | "cans"
  | "dome";

const GLYPH_FOR: Record<ModelKind, Glyph> = {
  poster: "flat",
  framedArt: "flat",
  tapestry: "flat",
  photoGrid: "flat",
  mirror: "disc",
  rug: "flat",
  neonSign: "neon",
  ledStrip: "run",
  stringLights: "run",
  wallClock: "disc",
  discoBall: "disc",
  moonLamp: "disc",
  lavaLamp: "vessel",
  saltLamp: "blob",
  jellyLamp: "dome",
  shelf: "shelf",
  hexShelf: "shelf",
  controllerMount: "shelf",
  monitorRiser: "shelf",
  miniBookshelf: "shelf",
  sideTable: "shelf",
  organizer: "shelf",
  deskLamp: "lamp",
  sunsetLamp: "lamp",
  barLamp: "lamp",
  plant: "plant",
  hangingPlant: "plant",
  vase: "vessel",
  candle: "vessel",
  diffuser: "vessel",
  speaker: "vessel",
  figure: "figure",
  funko: "figure",
  bust: "figure",
  books: "books",
  headphoneStand: "stand",
  beanbag: "blob",
  sodaCans: "cans",
  mushroomLamp: "dome",
  cloudLight: "blob",
  checkerRug: "flat",
  /* furniture */
  bed: "bedGlyph",
  desk: "box",
  wardrobe: "box",
  bookshelfTall: "shelf",
  chair: "box",
  nightstand: "box",
  tvUnit: "box",
  sofa: "blob",
  dresser: "box",
  doorway: "opening",
  windowFrame: "opening",
  custom: "box",
};

function GlyphPaths({ glyph, a, b }: { glyph: Glyph; a: string; b: string }) {
  const stroke = { stroke: a, strokeWidth: 2.4, fill: "none", strokeLinecap: "round" as const };

  switch (glyph) {
    case "flat":
      return (
        <>
          <rect x="18" y="12" width="28" height="40" rx="2" fill={a} opacity="0.9" />
          <path d="M18 38 L28 26 L35 34 L42 28 L46 33" stroke={b} strokeWidth="2" fill="none" />
          <circle cx="38" cy="21" r="3.4" fill={b} />
        </>
      );

    case "neon":
      return (
        <>
          <path
            d="M12 40 C18 20, 26 20, 32 32 S46 44, 52 24"
            {...stroke}
            strokeWidth="3.4"
          />
          <path
            d="M12 40 C18 20, 26 20, 32 32 S46 44, 52 24"
            stroke={a}
            strokeWidth="9"
            fill="none"
            opacity="0.2"
            strokeLinecap="round"
          />
        </>
      );

    case "run":
      return (
        <>
          <path d="M10 40 Q32 52 54 40" {...stroke} strokeWidth="1.6" />
          {[16, 26, 36, 46].map((x, i) => (
            <circle key={x} cx={x} cy={i === 1 || i === 2 ? 47 : 43.5} r="3.2" fill={a} />
          ))}
        </>
      );

    case "disc":
      return (
        <>
          <circle cx="32" cy="32" r="17" fill={a} opacity="0.92" />
          <circle cx="32" cy="32" r="17" stroke={b} strokeWidth="2" fill="none" />
          <circle cx="26" cy="26" r="5" fill={b} opacity="0.45" />
        </>
      );

    case "shelf":
      return (
        <>
          <rect x="10" y="30" width="44" height="5" rx="1.5" fill={a} />
          <rect x="16" y="35" width="4" height="9" fill={b} opacity="0.8" />
          <rect x="44" y="35" width="4" height="9" fill={b} opacity="0.8" />
          <rect x="24" y="19" width="6" height="11" rx="1" fill={b} />
          <rect x="33" y="22" width="5" height="8" rx="1" fill={b} opacity="0.7" />
        </>
      );

    case "lamp":
      return (
        <>
          <rect x="24" y="47" width="16" height="4" rx="2" fill={a} />
          <path d="M32 47 L32 26" {...stroke} />
          <path d="M32 26 L44 26" {...stroke} />
          <path d="M38 26 L48 26 L44 34 L36 34 Z" fill={a} />
          <path d="M42 36 L42 44" stroke={b} strokeWidth="2.4" opacity="0.55" />
        </>
      );

    case "plant":
      return (
        <>
          <path d="M23 42 L41 42 L38 54 L26 54 Z" fill={b} />
          <path d="M32 42 C32 30, 24 26, 21 20" {...stroke} />
          <path d="M32 42 C32 32, 40 27, 44 22" {...stroke} />
          <ellipse cx="20" cy="19" rx="6" ry="4" fill={a} transform="rotate(-28 20 19)" />
          <ellipse cx="45" cy="21" rx="6" ry="4" fill={a} transform="rotate(24 45 21)" />
          <ellipse cx="32" cy="27" rx="5.5" ry="3.6" fill={a} opacity="0.8" />
        </>
      );

    case "vessel":
      return (
        <>
          <path d="M26 20 L38 20 L41 36 C41 46, 23 46, 23 36 Z" fill={a} />
          <path d="M26 20 L38 20" stroke={b} strokeWidth="2.4" />
          <ellipse cx="32" cy="45" rx="9" ry="2.4" fill={b} opacity="0.35" />
        </>
      );

    case "figure":
      return (
        <>
          <ellipse cx="32" cy="51" rx="12" ry="3" fill={b} opacity="0.5" />
          <circle cx="32" cy="21" r="7.5" fill={a} />
          <path d="M32 29 L32 42" stroke={a} strokeWidth="7" strokeLinecap="round" />
          <path d="M25 44 L39 44 L37 49 L27 49 Z" fill={b} />
          <path d="M25 33 L20 39 M39 33 L44 39" stroke={a} strokeWidth="3.4" strokeLinecap="round" />
        </>
      );

    case "books":
      return (
        <>
          <rect x="16" y="40" width="32" height="8" rx="1.5" fill={a} />
          <rect x="18" y="31" width="28" height="8" rx="1.5" fill={b} />
          <rect x="21" y="22" width="23" height="8" rx="1.5" fill={a} opacity="0.75" />
        </>
      );

    case "stand":
      return (
        <>
          <ellipse cx="32" cy="49" rx="12" ry="3.4" fill={a} />
          <path d="M32 49 L32 24" {...stroke} strokeWidth="3.4" />
          <path d="M22 24 A10 10 0 0 1 42 24" stroke={b} strokeWidth="4" fill="none" strokeLinecap="round" />
        </>
      );

    case "box":
      return (
        <>
          <path d="M12 24 L32 16 L52 24 L52 46 L32 54 L12 46 Z" fill={a} />
          <path d="M12 24 L32 32 L52 24" stroke={b} strokeWidth="2" fill="none" />
          <path d="M32 32 L32 54" stroke={b} strokeWidth="2" />
        </>
      );

    case "bedGlyph":
      return (
        <>
          <rect x="10" y="30" width="44" height="14" rx="3" fill={a} />
          <rect x="10" y="22" width="6" height="22" rx="2" fill={b} />
          <rect x="18" y="26" width="15" height="8" rx="2.5" fill="#f2efe8" />
          <rect x="10" y="44" width="5" height="8" rx="1.5" fill={b} />
          <rect x="49" y="44" width="5" height="8" rx="1.5" fill={b} />
        </>
      );

    case "cans":
      return (
        <>
          {[18, 32, 46].map((x, i) => (
            <g key={x}>
              <rect x={x - 7} y={22 + i % 2 * 3} width="14" height="28" rx="2" fill={a} />
              <rect x={x - 7} y={30 + i % 2 * 3} width="14" height="7" fill={b} opacity="0.85" />
              <rect x={x - 5} y={19 + i % 2 * 3} width="10" height="4" rx="1.5" fill="#d9dde3" />
            </g>
          ))}
        </>
      );

    case "dome":
      return (
        <>
          <ellipse cx="32" cy="49" rx="11" ry="3" fill={b} opacity="0.6" />
          <rect x="30" y="30" width="4" height="18" fill={b} />
          <path d="M14 32 A18 18 0 0 1 50 32 Z" fill={a} />
          <path d="M14 32 L50 32" stroke={b} strokeWidth="2" opacity="0.5" />
        </>
      );

    case "opening":
      return (
        <>
          <rect x="18" y="12" width="28" height="42" rx="1.5" fill={b} opacity="0.55" />
          <rect x="22" y="16" width="20" height="34" rx="1" fill={a} />
          <circle cx="38" cy="34" r="2.2" fill={b} />
        </>
      );

    case "blob":
    default:
      return (
        <>
          <path
            d="M16 46 C14 32, 24 22, 34 22 C46 22, 52 32, 50 44 C49 50, 40 52, 32 52 C24 52, 17 51, 16 46 Z"
            fill={a}
          />
          <path d="M26 30 C30 26, 40 27, 43 32" stroke={b} strokeWidth="2" fill="none" opacity="0.6" />
        </>
      );
  }
}

export function ProductThumb({
  product,
  className,
}: {
  product: Product;
  className?: string;
}) {
  const glyph = GLYPH_FOR[product.model] ?? "flat";
  const [a, b = a] = product.palette;
  const glow = product.emissive?.color;
  // The real 3D render once it exists; the drawn glyph holds the space until then.
  const render = useProductRender(product);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[13px] border border-white/8",
        className,
      )}
      style={{
        background: glow
          ? `radial-gradient(62% 58% at 50% 52%, ${glow}30 0%, transparent 72%), linear-gradient(158deg, #17171c 0%, #0c0c0f 100%)`
          : "linear-gradient(158deg, #17171c 0%, #0c0c0f 100%)",
      }}
    >
      {glow && (
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 rounded-full blur-lg"
          style={{ background: glow, opacity: 0.4 }}
        />
      )}
      {render ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={render}
          alt=""
          draggable={false}
          className="relative size-full object-contain p-[6%] animate-fade"
        />
      ) : product.custom?.image ? (
        // The user's own cutout is the best possible thumbnail for their item.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.custom.image}
          alt=""
          draggable={false}
          className="relative size-full object-contain p-1.5"
        />
      ) : (
        <svg viewBox="0 0 64 64" className="relative size-full" aria-hidden>
          <GlyphPaths
            glyph={product.custom?.shape === "sphere" || product.custom?.shape === "cylinder" ? "disc" : glyph}
            a={a}
            b={b}
          />
        </svg>
      )}
    </div>
  );
}

