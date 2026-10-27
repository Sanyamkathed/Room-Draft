"use client";

import * as React from "react";
import { Camera, Check, Plus, Ruler, Trash2 } from "lucide-react";
import { DIMENSION_LIMITS } from "@/lib/room/plan";
import { SURFACE_HINTS, SURFACE_LABELS, SURFACE_ORDER } from "@/lib/room/surfaces";
import type { RoomPlan, SurfaceId } from "@/lib/room/types";
import type { ProjectImage } from "@/lib/storage/types";
import { Badge, Segmented } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";

const M_PER_FT = 0.3048;

/* ------------------------------------------------------------------ */
/* Dimensions                                                          */
/* ------------------------------------------------------------------ */

function DimensionField({
  label,
  metres,
  units,
  min,
  max,
  onChange,
}: {
  label: string;
  metres: number;
  units: "m" | "ft";
  min: number;
  max: number;
  onChange: (metres: number) => void;
}) {
  const display = units === "m" ? metres : metres / M_PER_FT;
  // Free text while typing, so a half-finished "3." doesn't snap to 3.
  const [text, setText] = React.useState(display.toFixed(units === "m" ? 2 : 1));

  React.useEffect(() => {
    setText(display.toFixed(units === "m" ? 2 : 1));
  }, [display, units]);

  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) {
      setText(display.toFixed(units === "m" ? 2 : 1));
      return;
    }
    const asMetres = units === "m" ? n : n * M_PER_FT;
    onChange(Math.min(max, Math.max(min, asMetres)));
  };

  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-[0.09em] text-chalk-3 font-medium">
        {label}
      </span>
      <div className="mt-1.5 flex items-center gap-2 rounded-[11px] border border-white/10 bg-ink-2 px-3 focus-within:border-accent/50">
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-10 w-full bg-transparent text-[15px] font-semibold tabular-nums text-chalk outline-none"
        />
        <span className="shrink-0 text-[12px] text-chalk-4">{units}</span>
      </div>
    </label>
  );
}

/**
 * Typed room dimensions with a live plan view.
 *
 * This is the one measurement the whole full-room path rests on: with six
 * independent photos there is no shared camera to solve scale from, so these
 * numbers are what every product gets sized against. The plan view exists to
 * make a typo obvious — a room that reads as a corridor on screen is one the
 * user will fix before it silently distorts everything they place.
 */
export function DimensionsStep({
  dimensions,
  units,
  onChange,
  onUnits,
}: {
  dimensions: RoomPlan["dimensions"];
  units: "m" | "ft";
  onChange: (d: RoomPlan["dimensions"]) => void;
  onUnits: (u: "m" | "ft") => void;
}) {
  const { width, depth, height } = dimensions;
  const area = width * depth;

  // Plan view, scaled to fit a fixed box whichever way round the room is.
  const scale = Math.min(260 / width, 200 / depth);
  const pw = width * scale;
  const pd = depth * scale;

  return (
    <div className="grid gap-7 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.11em] text-chalk-3 font-semibold">
            <Ruler className="size-3.5" />
            Room size
          </p>
          <Segmented
            options={[
              { value: "m", label: "Metres" },
              { value: "ft", label: "Feet" },
            ]}
            value={units}
            onChange={onUnits}
            size="sm"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <DimensionField
            label="Width"
            metres={width}
            units={units}
            min={DIMENSION_LIMITS.width[0]}
            max={DIMENSION_LIMITS.width[1]}
            onChange={(w) => onChange({ ...dimensions, width: w })}
          />
          <DimensionField
            label="Depth"
            metres={depth}
            units={units}
            min={DIMENSION_LIMITS.depth[0]}
            max={DIMENSION_LIMITS.depth[1]}
            onChange={(d) => onChange({ ...dimensions, depth: d })}
          />
          <DimensionField
            label="Height"
            metres={height}
            units={units}
            min={DIMENSION_LIMITS.height[0]}
            max={DIMENSION_LIMITS.height[1]}
            onChange={(h) => onChange({ ...dimensions, height: h })}
          />
        </div>

        <p className="text-[12.5px] leading-relaxed text-chalk-3">
          Measure one wall and the ceiling if you can — a tape measure or even a
          phone laser gets you within a couple of centimetres. Everything you
          place is scaled against these numbers, and you can change them later.
        </p>

        <div className="flex flex-wrap gap-2">
          {[
            { label: "Hostel room", d: { width: 3.0, depth: 3.6, height: 2.7 } },
            { label: "Small bedroom", d: { width: 3.5, depth: 4.0, height: 2.7 } },
            { label: "Large bedroom", d: { width: 4.2, depth: 5.0, height: 3.0 } },
          ].map((preset) => (
            <button
              key={preset.label}
              onClick={() => onChange(preset.d)}
              className="rounded-full border border-white/10 bg-white/4 px-3 py-1.5 text-[11.5px] font-medium text-chalk-2 transition-colors hover:border-white/25 hover:text-chalk"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* ---------------- Plan view ---------------- */}
      <div className="rounded-[var(--radius-card)] border border-white/8 bg-ink-1 p-6">
        <div className="flex items-center justify-center" style={{ minHeight: 240 }}>
          <svg width={pw + 80} height={pd + 80} className="overflow-visible">
            <rect
              x={40}
              y={40}
              width={pw}
              height={pd}
              rx={2}
              fill="rgba(212,171,116,0.06)"
              stroke="#d4ab74"
              strokeWidth={1.5}
            />
            {/* Back wall marker — the one people usually shoot first */}
            <rect x={40} y={36} width={pw} height={5} fill="#d4ab74" opacity={0.8} />
            <text
              x={40 + pw / 2}
              y={30}
              textAnchor="middle"
              className="fill-chalk-3"
              style={{ fontSize: 10, letterSpacing: "0.08em" }}
            >
              BACK WALL
            </text>

            {/* Width dimension */}
            <line
              x1={40}
              y1={pd + 58}
              x2={40 + pw}
              y2={pd + 58}
              stroke="rgba(255,255,255,0.3)"
              strokeWidth={1}
            />
            <text
              x={40 + pw / 2}
              y={pd + 74}
              textAnchor="middle"
              className="fill-chalk-2"
              style={{ fontSize: 11 }}
            >
              {width.toFixed(2)} m
            </text>

            {/* Depth dimension */}
            <line
              x1={pw + 58}
              y1={40}
              x2={pw + 58}
              y2={40 + pd}
              stroke="rgba(255,255,255,0.3)"
              strokeWidth={1}
            />
            <text
              x={pw + 64}
              y={40 + pd / 2}
              className="fill-chalk-2"
              style={{ fontSize: 11 }}
              dominantBaseline="middle"
            >
              {depth.toFixed(2)} m
            </text>
          </svg>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-white/7 pt-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.09em] text-chalk-4">Floor area</p>
            <p className="text-[17px] font-semibold tabular-nums">
              {area.toFixed(1)} m² <span className="text-[12px] text-chalk-4">
                ({(area * 10.7639).toFixed(0)} sq ft)
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-[0.09em] text-chalk-4">Ceiling</p>
            <p className="text-[17px] font-semibold tabular-nums">{height.toFixed(2)} m</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Surface grid                                                        */
/* ------------------------------------------------------------------ */

/**
 * The six surfaces, each a slot for one photo.
 *
 * Nothing here is required. A surface with no photo renders as clean painted
 * wall in the room, which is a perfectly good outcome for a ceiling nobody
 * wants to look at — so the grid nudges rather than blocks, and the walls are
 * ordered by how much difference they actually make.
 */
export function SurfaceGrid({
  plan,
  images,
  onPick,
  onRemove,
}: {
  plan: RoomPlan;
  images: ProjectImage[];
  onPick: (surface: SurfaceId) => void;
  onRemove: (surface: SurfaceId) => void;
}) {
  const imageFor = (surface: SurfaceId) => {
    const photo = plan.surfaces[surface];
    if (!photo) return null;
    return images.find((i) => i.id === photo.imageId) ?? null;
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {SURFACE_ORDER.map((surface) => {
        const image = imageFor(surface);
        const captured = Boolean(image);

        return (
          <div
            key={surface}
            className={cn(
              "group relative overflow-hidden rounded-[var(--radius-card)] border transition-all duration-300",
              captured
                ? "border-accent/40 bg-ink-1"
                : "border-dashed border-white/12 bg-ink-1/50 hover:border-white/28",
            )}
          >
            <button
              onClick={() => onPick(surface)}
              className="block w-full text-left"
              aria-label={`${captured ? "Replace" : "Add"} photo for ${SURFACE_LABELS[surface]}`}
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-ink-2">
                {image ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={image.dataUrl}
                    alt={SURFACE_LABELS[surface]}
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex size-full flex-col items-center justify-center gap-2 text-chalk-4">
                    <div className="grid size-10 place-items-center rounded-[12px] bg-white/5 transition-colors group-hover:bg-accent group-hover:text-black">
                      <Plus className="size-4.5" strokeWidth={2.2} />
                    </div>
                    <Camera className="size-3.5 opacity-50" />
                  </div>
                )}

                {captured && (
                  <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-accent text-black">
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                )}
              </div>

              <div className="p-3">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-semibold tracking-[-0.015em]">
                    {SURFACE_LABELS[surface]}
                  </p>
                  {!captured && surface === "back" && (
                    <Badge tone="accent">START HERE</Badge>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-chalk-4">
                  {captured ? "Tap to re-mark the corners" : SURFACE_HINTS[surface]}
                </p>
              </div>
            </button>

            {captured && (
              <button
                onClick={() => onRemove(surface)}
                aria-label={`Remove the ${SURFACE_LABELS[surface]} photo`}
                className="absolute left-2 top-2 grid size-7 place-items-center rounded-[9px] bg-black/65 text-chalk-2 opacity-0 backdrop-blur transition-all hover:text-danger group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
