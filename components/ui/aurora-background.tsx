"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";

type AuroraVariant =
  | "roomdraft"
  | "default"
  | "sunset"
  | "ocean"
  | "forest"
  | "lavender"
  | "ember"
  | "ice"
  | "custom";

interface AuroraBackgroundProps {
  className?: string;
  variant?: AuroraVariant;
  colors?: [string, string, string];
  speed?: number;
  blobCount?: number;
  children?: React.ReactNode;
  childrenClassName?: string;
}

const VARIANTS: Record<AuroraVariant, [string, string, string][]> = {
  custom: [],
  // RoomDraft: soft gold and warm brown light on the brown-charcoal base,
  // with a faint cream lift. Kept low so text above it stays easy to read.
  roomdraft: [
    ["hsla(35, 62%, 60%, 0.22)", "hsla(26, 48%, 36%, 0.12)", "transparent"],
    ["hsla(38, 62%, 84%, 0.08)", "transparent", "transparent"],
    ["hsla(20, 52%, 44%, 0.18)", "hsla(30, 42%, 26%, 0.09)", "transparent"],
  ],
  default: [
    ["hsla(260, 70%, 60%, 0.4)", "hsla(280, 60%, 50%, 0.2)", "transparent"],
    ["hsla(320, 80%, 70%, 0.3)", "transparent", "transparent"],
  ],
  ember: [
    ["hsla(25, 95%, 55%, 0.5)", "hsla(0, 90%, 50%, 0.3)", "transparent"],
    ["hsla(45, 90%, 60%, 0.4)", "transparent", "transparent"],
  ],
  forest: [
    ["hsla(145, 60%, 45%, 0.45)", "hsla(165, 55%, 40%, 0.25)", "transparent"],
    ["hsla(120, 65%, 50%, 0.35)", "transparent", "transparent"],
  ],
  ice: [
    ["hsla(200, 70%, 75%, 0.4)", "hsla(220, 60%, 85%, 0.25)", "transparent"],
    ["hsla(180, 65%, 80%, 0.35)", "transparent", "transparent"],
  ],
  lavender: [
    ["hsla(270, 70%, 65%, 0.45)", "hsla(300, 60%, 55%, 0.25)", "transparent"],
    ["hsla(240, 75%, 70%, 0.35)", "transparent", "transparent"],
  ],
  ocean: [
    ["hsla(195, 80%, 50%, 0.45)", "hsla(220, 70%, 45%, 0.25)", "transparent"],
    ["hsla(170, 75%, 55%, 0.35)", "transparent", "transparent"],
  ],
  sunset: [
    ["hsla(15, 90%, 65%, 0.5)", "hsla(350, 80%, 55%, 0.3)", "transparent"],
    ["hsla(45, 95%, 60%, 0.4)", "transparent", "transparent"],
  ],
};

/**
 * Soft drifting light, drawn on a canvas.
 *
 * Tuned to run as a full-page backdrop on phones: the canvas renders at a
 * quarter of the CSS size (the gradients are soft, so it looks the same once
 * stretched), it draws at most ~30 frames a second, it stops while the tab is
 * hidden, and it holds a single still frame for reduced-motion users.
 */
export function AuroraBackground({
  className,
  variant = "roomdraft",
  colors,
  speed = 1,
  blobCount = 5,
  children,
  childrenClassName,
}: AuroraBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const palette =
      variant === "custom" && colors
        ? [
            [colors[0], colors[1], colors[2]],
            [colors[0], "transparent", "transparent"],
          ]
        : VARIANTS[variant];

    const SCALE = 0.25;
    const resize = () => {
      canvas.width = Math.max(1, Math.round(canvas.offsetWidth * SCALE));
      canvas.height = Math.max(1, Math.round(canvas.offsetHeight * SCALE));
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const t = timeRef.current;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < blobCount; i++) {
        const layer = palette[i % palette.length];
        if (!layer) continue;
        const [c1, c2, c3] = layer;
        const phase = (i / blobCount) * Math.PI * 2 + t;
        const x = w / 2 + Math.sin(phase) * (w * 0.2) + Math.cos(t * 0.5) * (w * 0.1);
        const y = h / 2 + Math.cos(phase * 0.7) * (h * 0.2) + Math.sin(t * 0.3) * (h * 0.1);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(w, h) * 0.4);
        gradient.addColorStop(0, c1 ?? "transparent");
        gradient.addColorStop(0.5, c2 ?? "transparent");
        gradient.addColorStop(1, c3 ?? "transparent");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }

      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < Math.min(2, palette.length); i++) {
        const layer = palette[i];
        if (!layer) continue;
        const phase = (i / 2) * Math.PI + t * 0.8;
        const x = w / 2 + Math.sin(phase * 1.2) * (w * 0.15);
        const y = h / 2 + Math.cos(phase * 0.9) * (h * 0.15);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(w, h) * 0.35);
        gradient.addColorStop(0, layer[0] ?? "transparent");
        gradient.addColorStop(1, "transparent");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = "source-over";
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      draw();
      return () => window.removeEventListener("resize", resize);
    }

    let raf = 0;
    let last = 0;
    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      if (document.hidden || now - last < 33) return;
      // Advance by real elapsed time, so a skipped frame doesn't slow the drift.
      timeRef.current += 0.01 * speed * Math.min(4, (now - last) / 16.7 || 1);
      last = now;
      draw();
    };
    raf = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, [variant, colors, speed, blobCount]);

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
      {children && <div className={cn("relative", childrenClassName)}>{children}</div>}
    </div>
  );
}

export default AuroraBackground;
