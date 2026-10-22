"use client";

import * as React from "react";
import { Columns2, Download, X } from "lucide-react";
import { rectifiedSize, rectifyToDataUrl } from "@/lib/room/rectify";
import { surfaceExtent } from "@/lib/room/surfaces";
import { photoContainRect } from "@/lib/three/photoCamera";
import { useStudio } from "@/lib/store/studio";
import { downloadDataUrl } from "@/lib/utils/image";
import { Button } from "@/components/ui/primitives";

/**
 * Before / after.
 *
 * This renders *into the studio's existing viewport* rather than opening a
 * second canvas. Two live WebGL contexts on a modest GPU is enough to get one
 * of them dropped ("THREE.WebGLRenderer: Context Lost"), which showed up as a
 * black panel exactly where the payoff shot should be.
 *
 * It works because `applyPhotoCamera` letterboxes the reconstruction into the
 * canvas as a plain `contain` fit of the photo's aspect ratio — so an <img> of
 * the original photo with `object-contain` over the same box lines up pixel
 * for pixel, automatically, at any canvas size. Switching the camera to photo
 * mode and clipping that image with the slider is the whole implementation.
 */
export function BeforeAfter({ onClose }: { onClose: () => void }) {
  const images = useStudio((s) => s.images);
  const room = useStudio((s) => s.room);
  const plan = useStudio((s) => s.plan);
  const project = useStudio((s) => s.project);
  const items = useStudio((s) => s.items);

  /**
   * The "before" frame.
   *
   * Quick mode already has one: the photo the room was solved from. Full mode
   * has no single view of the whole room, but it does have a straight-on shot
   * of each wall — so the comparison flattens the hero wall's photo to a
   * perfect rectangle, which is exactly what the head-on render shows.
   */
  const [beforeSrc, setBeforeSrc] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!room || !project) return;

    if (project.mode === "quick") {
      const primary = project.images[0];
      setBeforeSrc(primary ? (images[primary.id]?.src ?? null) : null);
      return;
    }

    const hero = room.hero ?? "back";
    const photo = plan?.surfaces[hero];
    const img = photo ? images[photo.imageId] : undefined;
    if (!photo || !img) {
      setBeforeSrc(null);
      return;
    }
    const [across, down] = surfaceExtent(hero, room.dimensions);
    const { width, height } = rectifiedSize(across, down);
    setBeforeSrc(rectifyToDataUrl(img, photo.quad, width, height));
  }, [room, project, plan, images]);

  const [split, setSplit] = React.useState(50);
  const [dragging, setDragging] = React.useState(false);
  const frame = React.useRef<HTMLDivElement>(null);

  // Take over the studio's camera and chrome for the duration, then hand back
  // exactly what was there before.
  React.useEffect(() => {
    const s = useStudio.getState();
    const previous = {
      mode: s.cameraMode,
      left: s.leftPanelOpen,
      right: s.rightPanelOpen,
      selected: s.selectedId,
    };

    s.select(null);
    s.setCameraMode("photo");
    s.setLeftPanel(false);
    s.setRightPanel(false);

    return () => {
      const t = useStudio.getState();
      t.setCameraMode(previous.mode);
      t.setLeftPanel(previous.left);
      t.setRightPanel(previous.right);
      t.select(previous.selected);
    };
  }, []);

  const move = React.useCallback((clientX: number) => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect) return;
    setSplit(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  React.useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => move(e.clientX);
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
    };
  }, [dragging, move]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setSplit((s) => Math.max(0, s - 4));
      if (e.key === "ArrowRight") setSplit((s) => Math.min(100, s + 4));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Export just the photo's frame, with the letterbox cropped away. */
  const exportPng = React.useCallback(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-engine]");
    if (!canvas || !room) return;

    const r = photoContainRect(canvas.width, canvas.height, room.imageAspect);
    const out = document.createElement("canvas");
    out.width = Math.round(r.width);
    out.height = Math.round(r.height);
    out
      .getContext("2d")
      ?.drawImage(canvas, r.x, r.y, r.width, r.height, 0, 0, out.width, out.height);

    downloadDataUrl(
      out.toDataURL("image/png"),
      `${(project?.name ?? "aura-room").replace(/\s+/g, "-").toLowerCase()}-after.png`,
    );
  }, [room, project?.name]);

  if (!room) return null;

  return (
    <div className="pointer-events-auto absolute inset-0 z-40">
      {/* BEFORE — object-contain matches the render's own letterbox exactly */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
      >
        {beforeSrc ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={beforeSrc}
            alt="Your room before"
            className="size-full object-contain drag-none"
            draggable={false}
          />
        ) : (
          <div className="grid size-full place-items-center bg-ink-1">
            <p className="max-w-[24ch] text-center text-[12.5px] text-chalk-3">
              No photo covers this view yet — capture the {room.hero ?? "back"} wall to
              compare it.
            </p>
          </div>
        )}
      </div>

      {/* Drag surface + handle */}
      <div
        ref={frame}
        className="absolute inset-0 cursor-ew-resize touch-none"
        onPointerDown={(e) => {
          setDragging(true);
          move(e.clientX);
        }}
      >
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-white/85"
          style={{ left: `${split}%` }}
        >
          <div className="absolute left-1/2 top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-ink-0 shadow-[0_4px_20px_rgba(0,0,0,0.7)]">
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
            >
              <path
                d="M9 6 L4 12 L9 18 M15 6 L20 12 L15 18"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        <span
          className="pointer-events-none absolute left-4 top-16 rounded-full glass-strong px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] text-chalk transition-opacity"
          style={{ opacity: split > 14 ? 1 : 0 }}
        >
          BEFORE
        </span>
        <span
          className="pointer-events-none absolute right-4 top-16 rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] text-black transition-opacity"
          style={{ opacity: split < 86 ? 1 : 0 }}
        >
          AFTER
        </span>
      </div>

      {/* Chrome */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto rounded-[12px] glass-strong px-3.5 py-2 edge-light">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold tracking-[-0.015em]">
            <Columns2 className="size-3.5 text-accent" />
            Before &amp; after
          </p>
          <p className="text-[11px] text-chalk-4">
            Same camera, same frame — {items.length}{" "}
            {items.length === 1 ? "piece" : "pieces"} added
          </p>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={exportPng}>
            <Download className="size-3.5" />
            Export PNG
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose} aria-label="Close comparison">
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <p className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-[11.5px] text-chalk-3">
        Drag to compare · ← → to nudge · Esc to go back
      </p>
    </div>
  );
}
