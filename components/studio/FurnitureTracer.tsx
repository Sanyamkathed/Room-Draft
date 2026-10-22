"use client";

import * as React from "react";
import { Check, MousePointerSquareDashed, X } from "lucide-react";
import { FURNITURE, FURNITURE_BY_ID } from "@/lib/catalog/furniture";
import { resolvePlacement } from "@/lib/placement/resolve";
import { surfaceQuadInPhoto } from "@/lib/room/reconstruct";
import { measureTrace, againstWall, TRACEABLE_SURFACES } from "@/lib/room/wallPlacement";
import { SURFACE_LABELS } from "@/lib/room/surfaces";
import type { Quad, SurfaceId, Vec2, Vec3 } from "@/lib/room/types";
import { useStudio } from "@/lib/store/studio";
import { Badge, Button, Slider } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";
import { ProductThumb } from "./ProductThumb";

/** Types worth tracing — things that stand against a wall at a measurable size. */
const TRACEABLE_TYPES = [
  "fn-wardrobe",
  "fn-bed-double",
  "fn-desk",
  "fn-bookshelf",
  "fn-dresser",
  "fn-tv-unit",
  "fn-nightstand",
  "fn-sofa",
  "fn-door",
  "fn-window",
];

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function rectQuad(a: Vec2, b: Vec2): Quad {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  return { tl: [x0, y0], tr: [x1, y0], br: [x1, y1], bl: [x0, y1] };
}

/**
 * Tracing real furniture out of a wall photo.
 *
 * Draw a box around your wardrobe and it becomes a wardrobe-sized volume
 * standing exactly where yours does, with its face textured from that crop.
 * The measurement is real — the wall's homography converts the pixels back to
 * metres — so the result collides and stacks like anything else in the room.
 *
 * Only available where a surface has a photo: there is nothing to trace
 * against otherwise, and the library is the better tool in that case.
 */
export function FurnitureTracer({ onClose }: { onClose: () => void }) {
  const plan = useStudio((s) => s.plan);
  const project = useStudio((s) => s.project);
  const room = useStudio((s) => s.room);
  const calibration = useStudio((s) => s.calibration);
  const items = useStudio((s) => s.items);
  const addItemAt = useStudio((s) => s.addItemAt);

  /**
   * Which photo covers a given wall, and where that wall sits inside it.
   *
   * Full mode has this directly. Quick mode does not — but it has a solved
   * camera, so the wall's quad can be projected back into the single photo.
   * Both modes therefore trace through exactly the same measurement path, and
   * a one-photo user can still mark their real desk.
   */
  const sourceFor = React.useCallback(
    (id: SurfaceId): { imageId: string; quad: Quad } | null => {
      const fromPlan = plan?.surfaces[id];
      if (fromPlan) return fromPlan;

      const primary = project?.images[0];
      if (!room || !calibration || !primary) return null;
      const quad = surfaceQuadInPhoto(
        room,
        calibration,
        id,
        primary.width,
        primary.height,
      );
      return quad ? { imageId: primary.id, quad } : null;
    },
    [plan, project, room, calibration],
  );

  const available = React.useMemo(
    () => TRACEABLE_SURFACES.filter((id) => Boolean(sourceFor(id))),
    [sourceFor],
  );

  const [surface, setSurface] = React.useState<SurfaceId | null>(null);

  // The first usable wall, once one exists.
  React.useEffect(() => {
    setSurface((current) =>
      current && available.includes(current) ? current : (available[0] ?? null),
    );
  }, [available]);
  const [typeId, setTypeId] = React.useState(TRACEABLE_TYPES[0]);
  const [drag, setDrag] = React.useState<{ from: Vec2; to: Vec2 } | null>(null);
  const [box, setBox] = React.useState<Quad | null>(null);
  const [depthCm, setDepthCm] = React.useState(58);
  const frame = React.useRef<HTMLDivElement>(null);

  const photo = surface ? sourceFor(surface) : null;
  const image = photo ? project?.images.find((i) => i.id === photo.imageId) : undefined;
  const product = FURNITURE_BY_ID.get(typeId);

  React.useEffect(() => {
    if (product) setDepthCm(product.dims.d);
  }, [product]);

  React.useEffect(() => {
    setBox(null);
    setDrag(null);
  }, [surface]);

  const pointerTo = React.useCallback((e: React.PointerEvent | PointerEvent): Vec2 => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect) return [0.5, 0.5];
    return [
      clamp01((e.clientX - rect.left) / rect.width),
      clamp01((e.clientY - rect.top) / rect.height),
    ];
  }, []);

  React.useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      setDrag((d) => (d ? { ...d, to: pointerTo(e) } : d));
    };
    const stop = () => {
      setDrag((d) => {
        if (d) {
          const q = rectQuad(d.from, d.to);
          // Ignore a stray click that drew nothing.
          if (Math.abs(q.tr[0] - q.tl[0]) > 0.02 && Math.abs(q.bl[1] - q.tl[1]) > 0.02) {
            setBox(q);
          }
        }
        return null;
      });
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
    };
  }, [drag, pointerTo]);

  const live = drag ? rectQuad(drag.from, drag.to) : box;

  const measured =
    live && photo && room && surface
      ? measureTrace(photo.quad, live, surface, room.dimensions)
      : null;

  const place = React.useCallback(() => {
    if (!measured || !room || !surface || !product || !photo || !box) return;

    const depthM = depthCm / 100;
    const { position, yaw } = againstWall(
      surface,
      measured.centreAcross,
      depthM,
      room.dimensions,
    );

    const isWallMounted = product.mount === "wall";
    const size = {
      w: Math.round(measured.width * 100),
      h: Math.round(measured.height * 100),
      d: depthCm,
    };
    const trace = { imageId: photo.imageId, quad: box };

    const target: Vec3 = isWallMounted
      ? [position[0], measured.bottom + measured.height / 2, position[2]]
      : [position[0], 0, position[2]];

    // The measurement is trusted for SIZE, but the spot may already be taken —
    // by a library piece standing in for the same object, most likely. Running
    // it through the normal resolver keeps the app's one promise intact
    // (nothing interpenetrates) and only slides it along the wall it's on.
    const resolved = resolvePlacement(product, {
      room,
      items,
      hit: {
        point: target,
        normal: [0, 1, 0],
        surfaceId: isWallMounted ? surface : "floor",
      },
      ray: null,
      gridSnap: false,
      yaw: isWallMounted ? 0 : yaw,
      scale: 1,
      size,
      trace,
    });

    addItemAt(product.id, {
      id: `item_${Math.random().toString(36).slice(2, 10)}`,
      productId: product.id,
      position: resolved?.valid ? resolved.item.position : target,
      yaw: isWallMounted ? 0 : yaw,
      spin: 0,
      scale: 1,
      surface: isWallMounted ? surface : "floor",
      supportId: null,
      size,
      trace,
      createdAt: Date.now(),
    });

    onClose();
  }, [measured, room, surface, product, photo, box, depthCm, addItemAt, items, onClose]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (available.length === 0 || !image || !surface) {
    return (
      <div className="fixed inset-0 z-[70] grid place-items-center bg-ink-0/97 px-6 backdrop-blur-xl">
        <div className="max-w-[42ch] text-center">
          <div className="mx-auto grid size-11 place-items-center rounded-[13px] bg-white/6 text-chalk-2">
            <MousePointerSquareDashed className="size-5" />
          </div>
          <p className="mt-4 text-[16px] font-medium">Nothing to trace against yet</p>
          <p className="mt-2 text-[13px] leading-relaxed text-chalk-3">
            Tracing measures against a wall the camera could actually see. Add
            furniture from the library instead, or capture that wall first.
          </p>
          <Button variant="secondary" className="mt-6" onClick={onClose}>
            Back to the studio
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-ink-0/97 backdrop-blur-xl">
      <header className="flex h-[60px] shrink-0 items-center justify-between gap-4 border-b border-white/8 px-5">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.02em]">
            Trace furniture from your photo
          </h2>
          <p className="text-[11.5px] text-chalk-4">
            Drag a box around it — we&apos;ll measure it off the wall
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" disabled={!box} onClick={place}>
            <Check className="size-3.5" strokeWidth={2.6} />
            Place it
          </Button>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-8">
        <div className="mx-auto grid max-w-[1100px] gap-6 lg:grid-cols-[1.4fr_0.6fr] lg:items-start">
          {/* ---------------- Photo ---------------- */}
          <div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {available.map((s) => (
                <button
                  key={s}
                  onClick={() => setSurface(s)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
                    s === surface
                      ? "bg-chalk text-ink-0"
                      : "bg-white/5 text-chalk-3 hover:bg-white/10 hover:text-chalk",
                  )}
                >
                  {SURFACE_LABELS[s]}
                </button>
              ))}
            </div>

            <div
              ref={frame}
              onPointerDown={(e) => {
                e.preventDefault();
                const p = pointerTo(e);
                setBox(null);
                setDrag({ from: p, to: p });
              }}
              // Aspect-locked so pointer coordinates normalise against the
              // photo itself — a letterboxed image would shift every measurement.
              className="relative mx-auto max-h-[56vh] max-w-full cursor-crosshair select-none overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-ink-2 touch-none"
              style={{ aspectRatio: `${image.width} / ${image.height}` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.dataUrl}
                alt={SURFACE_LABELS[surface]}
                className="absolute inset-0 size-full drag-none"
                draggable={false}
              />

              {live && (
                <div
                  className="pointer-events-none absolute border-2 border-accent bg-accent/12"
                  style={{
                    left: `${live.tl[0] * 100}%`,
                    top: `${live.tl[1] * 100}%`,
                    width: `${(live.tr[0] - live.tl[0]) * 100}%`,
                    height: `${(live.bl[1] - live.tl[1]) * 100}%`,
                  }}
                />
              )}

              {!live && (
                <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center">
                  <p className="rounded-[10px] glass-strong px-3 py-1.5 text-[11.5px] font-medium text-chalk edge-light">
                    Drag a box around the furniture
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ---------------- Controls ---------------- */}
          <div className="space-y-5">
            <div>
              <p className="text-[11px] uppercase tracking-[0.11em] text-chalk-3 font-semibold">
                What is it?
              </p>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {TRACEABLE_TYPES.map((id) => {
                  const p = FURNITURE_BY_ID.get(id);
                  if (!p) return null;
                  return (
                    <button
                      key={id}
                      onClick={() => setTypeId(id)}
                      title={p.name}
                      className={cn(
                        "rounded-[12px] p-1 transition-all",
                        id === typeId ? "bg-accent" : "bg-white/5 hover:bg-white/10",
                      )}
                    >
                      <ProductThumb product={p} className="aspect-square w-full" />
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[12px] text-chalk-2">{product?.name}</p>
            </div>

            <div className="rounded-[var(--radius-card)] border border-white/8 bg-ink-1 p-4">
              <p className="text-[11px] uppercase tracking-[0.11em] text-chalk-3 font-semibold">
                Measured
              </p>
              {measured ? (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[11px] text-chalk-4">Width</p>
                      <p className="text-[18px] font-semibold tabular-nums">
                        {Math.round(measured.width * 100)} cm
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-chalk-4">Height</p>
                      <p className="text-[18px] font-semibold tabular-nums">
                        {Math.round(measured.height * 100)} cm
                      </p>
                    </div>
                  </div>
                  {measured.bottom > 0.12 && (
                    <p className="mt-2">
                      <Badge>
                        {Math.round(measured.bottom * 100)} cm off the floor
                      </Badge>
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-2 text-[12.5px] text-chalk-4">
                  Draw a box to measure it.
                </p>
              )}
            </div>

            <div className="rounded-[var(--radius-card)] border border-white/8 bg-ink-1 p-4">
              <Slider
                label="How deep is it?"
                value={depthCm}
                min={5}
                max={120}
                step={1}
                format={(v) => `${Math.round(v)} cm`}
                onChange={setDepthCm}
              />
              <p className="mt-2 text-[11.5px] leading-relaxed text-chalk-4">
                A photo of a wall can&apos;t see depth, so this one is a guess —
                started from a typical {product?.name.toLowerCase()}.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { FURNITURE };
