"use client";

import {
  BookOpen,
  Camera,
  Circle,
  Coffee,
  Disc3,
  Flower2,
  Gamepad2,
  Leaf,
  Lightbulb,
  Monitor,
  Moon,
  Shirt,
  Sparkles,
  Tv,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { AestheticId } from "@/lib/catalog/types";
import { aestheticById } from "@/lib/catalog/types";

/** One recognisable symbol per aesthetic, so a tile says what it is at a glance. */
const ICONS: Record<AestheticId, LucideIcon> = {
  "dark-academia": BookOpen,
  minimalist: Circle,
  cyberpunk: Zap,
  anime: Sparkles,
  gaming: Gamepad2,
  cozy: Coffee,
  scandinavian: Leaf,
  y2k: Disc3,
  indie: Flower2,
  retro: Tv,
  streetwear: Shirt,
  neon: Lightbulb,
  moody: Moon,
  "clean-desk": Monitor,
  creator: Camera,
};

/** True when a hex colour is light enough to need dark foreground marks. */
function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
}

/**
 * The visual stand-in for an aesthetic.
 *
 * Deliberately generated rather than photographed: every theme tile, mood
 * board and recommendation chip derives from the same three swatch colours,
 * so the whole Discover surface stays consistent and ships with no image
 * assets to download, licence or lazy-load.
 */
export function MoodTile({
  aesthetic,
  className,
  seed = 0,
  children,
}: {
  aesthetic: AestheticId;
  className?: string;
  seed?: number;
  children?: React.ReactNode;
}) {
  const a = aestheticById(aesthetic);
  const [base, mid, hot] = a.swatch;

  // A few deterministic variants so a grid of tiles from one theme doesn't
  // look like the same tile repeated.
  const angle = 120 + ((seed * 47) % 140);
  const x1 = 18 + ((seed * 23) % 50);
  const y1 = 14 + ((seed * 37) % 46);
  const x2 = 62 + ((seed * 19) % 32);
  const y2 = 58 + ((seed * 29) % 36);

  const Icon = ICONS[aesthetic] ?? Sparkles;
  const light = isLight(base);
  const ink = light ? "#1c1b19" : "#ffffff";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-card)] isolate",
        className,
      )}
      style={{
        background: `
          radial-gradient(70% 55% at ${x1}% ${y1}%, ${hot}30 0%, transparent 70%),
          radial-gradient(60% 60% at ${x2}% ${y2}%, ${mid}40 0%, transparent 72%),
          linear-gradient(${angle}deg, ${base} 0%, ${base} 50%, ${mid}33 100%),
          ${base}
        `,
      }}
    >
      {/* Faint dot grid: gives the tile structure instead of a bare blur */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage: `radial-gradient(${ink} 1px, transparent 1px)`,
          backgroundSize: "16px 16px",
          maskImage: "linear-gradient(to bottom, black, transparent 70%)",
          WebkitMaskImage: "linear-gradient(to bottom, black, transparent 70%)",
        }}
      />

      {/* Oversized icon as a watermark */}
      <Icon
        aria-hidden
        strokeWidth={1.1}
        className="pointer-events-none absolute -right-6 -top-5 size-36 rotate-[8deg]"
        style={{ color: hot, opacity: light ? 0.28 : 0.2 }}
      />

      {/* Icon badge + palette */}
      <div className="absolute left-3.5 top-3.5 flex items-center gap-2">
        <span
          className="grid size-9 place-items-center rounded-[11px] backdrop-blur-sm"
          style={{
            background: light ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.1)",
            boxShadow: `inset 0 0 0 1px ${light ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.16)"}`,
            color: light ? "#1c1b19" : hot,
          }}
        >
          <Icon className="size-[18px]" strokeWidth={1.8} />
        </span>
      </div>

      {/* Hairline + legibility scrim for the label */}
      <div className="pointer-events-none absolute inset-0 rounded-[var(--radius-card)] ring-1 ring-inset ring-white/10" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/60 to-transparent" />
      {children}
    </div>
  );
}

export function PaletteDots({
  aesthetic,
  className,
}: {
  aesthetic: AestheticId;
  className?: string;
}) {
  const a = aestheticById(aesthetic);
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {a.swatch.map((c) => (
        <span
          key={c}
          className="size-2.5 rounded-full ring-1 ring-white/20"
          style={{ background: c }}
        />
      ))}
    </div>
  );
}
