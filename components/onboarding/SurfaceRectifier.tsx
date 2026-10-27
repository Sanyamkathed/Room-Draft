"use client";

import * as React from "react";
import { AlertTriangle, FlipHorizontal, RotateCw } from "lucide-react";
import {
  defaultSurfaceQuad,
  flipQuad,
  isQuadMirrored,
  rotateQuad,
} from "@/lib/room/homography";
import { rectifyToCanvas } from "@/lib/room/rectify";
import { SURFACE_HINTS, SURFACE_LABELS } from "@/lib/room/surfaces";
import type { Quad, SurfaceId, Vec2 } from "@/lib/room/types";
import { IconButton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";

type Handle = "tl" | "tr" | "br" | "bl" | null;

const PREVIEW_WIDTH = 300;

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Marking one surface in one photo.
 *
 * The four corners the user drags are the entire input: they define the
 * homography that maps this photo onto this plane, which is all a straight-on
 * shot needs — no camera solve, no focal length, no guess about where they
 * stood. The live flattened preview beside it is the point of the interaction:
 * you can see the wall de-skew as you drag, so "is this right?" is answered by
 * looking rather than by trusting.
 */
export function SurfaceRectifier({
  surface,
  imageUrl,
  quad,
  onChange,
  extent,
}: {
  surface: SurfaceId;
  imageUrl: string;
  quad: Quad;
  onChange: (q: Quad) => void;
  /** Real-world size of this surface, [across, down] in metres. */
  extent: [number, number];
}) {
  const frame = React.useRef<HTMLDivElement>(null);
  const previewHost = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState<Handle>(null);
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);

  React.useEffect(() => {
    const el = new Image();
    el.onload = () => setImg(el);
    el.src = imageUrl;
  }, [imageUrl]);

  const mirrored = isQuadMirrored(quad);
  const imgAspect = img ? img.naturalWidth / img.naturalHeight : 4 / 3;

  /* -------------------- live flattened preview -------------------- */
  const previewHeight = Math.round((PREVIEW_WIDTH * extent[1]) / extent[0]);

  React.useEffect(() => {
    const host = previewHost.current;
    if (!host || !img) return;

    // Debounced: the warp is cheap but not free, and a drag fires every frame.
    const t = setTimeout(() => {
      const canvas = rectifyToCanvas(img, quad, PREVIEW_WIDTH, previewHeight, 12);
      host.replaceChildren();
      if (canvas) {
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        host.appendChild(canvas);
      }
    }, 40);

    return () => clearTimeout(t);
  }, [img, quad, previewHeight]);

  /* -------------------- dragging -------------------- */
  const pointerTo = React.useCallback((e: PointerEvent | React.PointerEvent): Vec2 => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect) return [0.5, 0.5];
    return [
      clamp((e.clientX - rect.left) / rect.width, 0, 1),
      clamp((e.clientY - rect.top) / rect.height, 0, 1),
    ];
  }, []);

  React.useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      onChange({ ...quad, [dragging]: pointerTo(e) });
    };
    const stop = () => setDragging(null);

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging, quad, onChange, pointerTo]);

  const corners: { key: Exclude<Handle, null>; p: Vec2; label: string }[] = [
    { key: "tl", p: quad.tl, label: "1" },
    { key: "tr", p: quad.tr, label: "2" },
    { key: "br", p: quad.br, label: "3" },
    { key: "bl", p: quad.bl, label: "4" },
  ];

  const pct = (v: number) => `${v * 100}%`;
  const poly = corners.map((c) => `${c.p[0] * 100},${c.p[1] * 100}`).join(" ");

  return (
    <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr] lg:items-start">
      {/* ---------------- Photo + handles ---------------- */}
      <div>
        <div
          ref={frame}
          // The frame must match the photo's aspect EXACTLY. Corner positions are
          // normalised against this element, but they are interpreted as image
          // coordinates by the homography — so any letterboxing inside the
          // frame would silently offset and scale every mapping.
          className="relative mx-auto max-h-[52vh] max-w-full select-none overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-ink-2 touch-none"
          style={{ aspectRatio: `${imgAspect}` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={SURFACE_LABELS[surface]}
            className="absolute inset-0 size-full drag-none"
            draggable={false}
          />

          <svg
            className="pointer-events-none absolute inset-0 size-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <defs>
              <mask id={`surface-mask-${surface}`}>
                <rect width="100" height="100" fill="white" />
                <polygon points={poly} fill="black" />
              </mask>
            </defs>
            <rect
              width="100"
              height="100"
              fill="rgba(8,8,10,0.6)"
              mask={`url(#surface-mask-${surface})`}
            />
            <polygon
              points={poly}
              fill="none"
              stroke={mirrored ? "#ff6b6b" : "#ff2d3a"}
              strokeWidth="0.3"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {corners.map((c) => (
            <button
              key={c.key}
              aria-label={`${SURFACE_LABELS[surface]} corner ${c.label}`}
              onPointerDown={(e) => {
                e.preventDefault();
                setDragging(c.key);
              }}
              className={cn(
                "absolute z-10 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full",
                "cursor-grab touch-none transition-transform duration-200 active:cursor-grabbing",
                dragging === c.key ? "scale-125" : "hover:scale-110",
              )}
              style={{ left: pct(c.p[0]), top: pct(c.p[1]) }}
            >
              <span className="grid size-5 place-items-center rounded-full border-2 border-black/60 bg-accent text-[9px] font-bold text-black shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
                {c.label}
              </span>
            </button>
          ))}

          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center">
            <p className="rounded-[10px] glass-strong px-3 py-1.5 text-center text-[11.5px] font-medium text-chalk edge-light">
              Drag 1 → 2 → 3 → 4 onto the corners, clockwise from top-left
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <IconButton
            label="Rotate the corner order"
            size="sm"
            onClick={() => onChange(rotateQuad(quad, 1))}
          >
            <RotateCw className="size-4" />
          </IconButton>
          <IconButton
            label="Mirror the corner order"
            size="sm"
            onClick={() => onChange(flipQuad(quad))}
          >
            <FlipHorizontal className="size-4" />
          </IconButton>
          <button
            onClick={() => onChange(defaultSurfaceQuad())}
            className="text-[11.5px] font-medium text-chalk-3 transition-colors hover:text-chalk"
          >
            Reset corners
          </button>

          {mirrored && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] font-medium text-danger">
              <AlertTriangle className="size-3.5" />
              Corners are inside-out — the wall will come out mirrored
            </span>
          )}
        </div>
      </div>

      {/* ---------------- Flattened preview ---------------- */}
      <div className="space-y-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.11em] text-chalk-3 font-semibold">
            Flattened
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-chalk-4">
            This is exactly what lands on the {SURFACE_LABELS[surface].toLowerCase()}.
            If it looks square and level, the corners are right.
          </p>
        </div>

        <div
          ref={previewHost}
          className="overflow-hidden rounded-[12px] border border-white/10 bg-ink-2"
          style={{ aspectRatio: `${extent[0]} / ${extent[1]}` }}
        />

        <p className="text-[11.5px] tabular-nums text-chalk-4">
          {extent[0].toFixed(2)} m across × {extent[1].toFixed(2)} m down
        </p>

        <p className="rounded-[10px] bg-white/4 px-3 py-2.5 text-[11.5px] leading-relaxed text-chalk-3">
          {SURFACE_HINTS[surface]}
        </p>
      </div>
    </div>
  );
}
