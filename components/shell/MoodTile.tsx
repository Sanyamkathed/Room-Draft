"use client";

import { cn } from "@/lib/utils/cn";
import type { AestheticId } from "@/lib/catalog/types";
import { aestheticById } from "@/lib/catalog/types";

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

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-card)] grain isolate",
        className,
      )}
      style={{
        background: `
          radial-gradient(58% 48% at ${x1}% ${y1}%, ${hot}55 0%, transparent 68%),
          radial-gradient(52% 56% at ${x2}% ${y2}%, ${mid}66 0%, transparent 72%),
          linear-gradient(${angle}deg, ${base} 0%, ${base} 42%, ${mid}2e 100%)
        `,
      }}
    >
      {/* Hairline + inner shadow keep the tile reading as a surface, not a blob */}
      <div className="pointer-events-none absolute inset-0 rounded-[var(--radius-card)] ring-1 ring-inset ring-white/10" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/55 to-transparent" />
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
