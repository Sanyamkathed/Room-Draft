"use client";

import * as React from "react";
import { Info, RotateCcw } from "lucide-react";
import { Button, Slider } from "@/components/ui/primitives";
import { clamp, defaultBackWall } from "@/lib/room/perspective";
import { reconstructRoom } from "@/lib/room/reconstruct";
import type { Quad, RoomCalibration, RoomGeometry, Vec2 } from "@/lib/room/types";
import { cn } from "@/lib/utils/cn";

type Handle = "tl" | "tr" | "br" | "bl" | "vp" | null;

const MIN_SPAN = 0.12;

/**
 * Perspective calibration.
 *
 * The vanishing point and back wall are estimated automatically, but a single
 * photo genuinely cannot pin down absolute scale on its own — so rather than
 * hiding a guess, the two assumptions that fix it (camera height and lens
 * field of view) are exposed as controls, with the resulting room dimensions
 * shown live. Four drags and a slider turn "probably about right" into
 * measurements the user has confirmed, which is what every product placed
 * afterwards is scaled against.
 */
export function Calibrator({
  imageUrl,
  imageWidth,
  imageHeight,
  palette,
  calibration,
  onChange,
}: {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  palette: RoomGeometry["palette"];
  calibration: RoomCalibration;
  onChange: (cal: RoomCalibration) => void;
}) {
  const frame = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState<Handle>(null);

  const room = React.useMemo(
    () => reconstructRoom(calibration, imageWidth, imageHeight, palette),
    [calibration, imageWidth, imageHeight, palette],
  );

  const q = calibration.backWall;
  const left = q.tl[0];
  const right = q.tr[0];
  const top = q.tl[1];
  const bottom = q.bl[1];
  const [vpx, vpy] = calibration.vanishingPoint;

  const setRect = React.useCallback(
    (l: number, r: number, t: number, b: number) => {
      const quad: Quad = {
        tl: [l, t],
        tr: [r, t],
        br: [r, b],
        bl: [l, b],
      };
      onChange({ ...calibration, backWall: quad });
    },
    [calibration, onChange],
  );

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
      const [x, y] = pointerTo(e);

      if (dragging === "vp") {
        // The wall base must stay below the horizon or the solve runs to
        // infinity, so the vanishing point can't be dragged past it.
        onChange({
          ...calibration,
          vanishingPoint: [clamp(x, 0.08, 0.92), clamp(y, 0.08, bottom - 0.03)],
        });
        return;
      }

      const l = dragging === "tl" || dragging === "bl" ? Math.min(x, right - MIN_SPAN) : left;
      const r = dragging === "tr" || dragging === "br" ? Math.max(x, left + MIN_SPAN) : right;
      const t = dragging === "tl" || dragging === "tr" ? Math.min(y, bottom - MIN_SPAN) : top;
      const b =
        dragging === "bl" || dragging === "br"
          ? Math.max(y, Math.max(top + MIN_SPAN, vpy + 0.03))
          : bottom;

      setRect(clamp(l, 0.02, 0.98), clamp(r, 0.02, 0.98), clamp(t, 0.02, 0.98), clamp(b, 0.02, 0.98));
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
  }, [dragging, pointerTo, calibration, onChange, left, right, top, bottom, vpy, setRect]);

  const pct = (v: number) => `${v * 100}%`;
  const fmt = (m: number) => `${m.toFixed(2)} m`;
  const feet = (m: number) => `${Math.floor(m * 3.28084)}′${Math.round(((m * 3.28084) % 1) * 12)}″`;

  const corners: { key: Exclude<Handle, null>; x: number; y: number }[] = [
    { key: "tl", x: left, y: top },
    { key: "tr", x: right, y: top },
    { key: "br", x: right, y: bottom },
    { key: "bl", x: left, y: bottom },
  ];

  return (
    <div className="grid gap-7 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
      {/* ---------------- Photo + overlay ---------------- */}
      <div
        ref={frame}
        // Aspect-locked to the photo: handle positions are normalised against
        // this element but read as image coordinates, so letterboxing inside
        // the frame would offset the whole reconstruction.
        className="relative mx-auto max-h-[62vh] max-w-full select-none overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-ink-2 touch-none"
        style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Your space"
          className="absolute inset-0 size-full drag-none"
          draggable={false}
        />

        <svg
          className="pointer-events-none absolute inset-0 size-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {/* Dim everything outside the back wall so the quad reads as a target */}
          <defs>
            <mask id="wall-mask">
              <rect width="100" height="100" fill="white" />
              <rect
                x={left * 100}
                y={top * 100}
                width={(right - left) * 100}
                height={(bottom - top) * 100}
                fill="black"
              />
            </mask>
          </defs>
          <rect width="100" height="100" fill="rgba(8,8,10,0.52)" mask="url(#wall-mask)" />

          {/* Rays from the vanishing point through each back-wall corner: the
              four side surfaces of the reconstruction, drawn as the user
              would see them */}
          {corners.map((c) => {
            const dx = c.x - vpx;
            const dy = c.y - vpy;
            const k = 40; // far past the frame edge
            return (
              <line
                key={`ray-${c.key}`}
                x1={c.x * 100}
                y1={c.y * 100}
                x2={(c.x + dx * k) * 100}
                y2={(c.y + dy * k) * 100}
                stroke="rgba(216,255,60,0.4)"
                strokeWidth="0.22"
                strokeDasharray="1.2 1"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          <rect
            x={left * 100}
            y={top * 100}
            width={(right - left) * 100}
            height={(bottom - top) * 100}
            fill="none"
            stroke="#d8ff3c"
            strokeWidth="0.3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Corner handles */}
        {corners.map((c) => (
          <button
            key={c.key}
            aria-label={`Back wall ${c.key} corner`}
            onPointerDown={(e) => {
              e.preventDefault();
              setDragging(c.key);
            }}
            className={cn(
              "absolute z-10 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full",
              "cursor-grab touch-none transition-transform duration-200 active:cursor-grabbing",
              dragging === c.key ? "scale-125" : "hover:scale-110",
            )}
            style={{ left: pct(c.x), top: pct(c.y) }}
          >
            <span className="size-3.5 rounded-full border-2 border-black/60 bg-accent shadow-[0_2px_10px_rgba(0,0,0,0.6)]" />
          </button>
        ))}

        {/* Vanishing point */}
        <button
          aria-label="Vanishing point"
          onPointerDown={(e) => {
            e.preventDefault();
            setDragging("vp");
          }}
          className={cn(
            "absolute z-10 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full",
            "cursor-grab touch-none transition-transform duration-200 active:cursor-grabbing",
            dragging === "vp" ? "scale-125" : "hover:scale-110",
          )}
          style={{ left: pct(vpx), top: pct(vpy) }}
        >
          <span className="absolute size-7 rounded-full border border-white/50" />
          <span className="size-1.5 rounded-full bg-white" />
        </button>

        <div className="pointer-events-none absolute bottom-3 left-3 rounded-[10px] glass-strong px-3 py-2 edge-light">
          <p className="text-[11px] font-medium text-chalk">
            Drag the corners onto the wall facing you
          </p>
        </div>
      </div>

      {/* ---------------- Controls ---------------- */}
      <div className="space-y-6">
        <div className="rounded-[var(--radius-card)] border border-white/8 bg-ink-1 p-5">
          <p className="text-[11px] uppercase tracking-[0.11em] text-chalk-3 font-semibold">
            Your room, measured
          </p>

          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              ["Width", room.dimensions.width],
              ["Depth", room.dimensions.depth],
              ["Height", room.dimensions.height],
            ].map(([label, value]) => (
              <div key={label as string}>
                <p className="text-[11px] text-chalk-4">{label as string}</p>
                <p className="mt-0.5 text-[19px] font-semibold tabular-nums tracking-[-0.03em]">
                  {fmt(value as number)}
                </p>
                <p className="text-[11px] tabular-nums text-chalk-4">
                  {feet(value as number)}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-chalk-3">
            <Info className="mt-0.5 size-3.5 shrink-0 text-chalk-4" />
            Everything you place is scaled against these numbers. If the room
            feels too big or small later, come back and nudge the camera height.
          </p>
        </div>

        <div className="space-y-5 rounded-[var(--radius-card)] border border-white/8 bg-ink-1 p-5">
          <Slider
            label="Camera height"
            value={calibration.cameraHeight}
            min={0.6}
            max={2.0}
            step={0.01}
            format={(v) => `${v.toFixed(2)} m`}
            onChange={(cameraHeight) => onChange({ ...calibration, cameraHeight })}
          />
          <p className="-mt-3 text-[11.5px] text-chalk-4">
            How high your phone was when you took the shot. This is what sets
            the room&apos;s real-world scale.
          </p>

          <Slider
            label="Lens field of view"
            value={calibration.fovDeg}
            min={40}
            max={95}
            step={1}
            format={(v) => `${Math.round(v)}°`}
            onChange={(fovDeg) => onChange({ ...calibration, fovDeg })}
          />
          <p className="-mt-3 text-[11.5px] text-chalk-4">
            Most phone main cameras land near 66°. Ultra-wide shots need more.
          </p>

          <Slider
            label="Space behind you"
            value={calibration.frontExtension}
            min={0.2}
            max={3.5}
            step={0.05}
            format={(v) => `${v.toFixed(2)} m`}
            onChange={(frontExtension) => onChange({ ...calibration, frontExtension })}
          />
          <p className="-mt-3 text-[11.5px] text-chalk-4">
            How much room continues behind the camera. The photo can&apos;t see
            it, so it renders as clean studio wall.
          </p>

          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() =>
              onChange({
                ...calibration,
                backWall: defaultBackWall(calibration.vanishingPoint),
                cameraHeight: 1.45,
                fovDeg: 66,
                frontExtension: 0.9,
              })
            }
          >
            <RotateCcw className="size-3.5" />
            Reset to the automatic fit
          </Button>
        </div>
      </div>
    </div>
  );
}
