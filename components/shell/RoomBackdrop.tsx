"use client";

import * as React from "react";

/**
 * The room backdrop, built from three depth layers.
 *
 * The same quiet wireframe room as the flat image (walls and floor, then the
 * window/shelf/desk/lamp, then the light glow) is split into layers and set at
 * different depths inside a CSS perspective. As the pointer moves — or, with no
 * pointer, on a slow idle drift — the layers shift against each other, so the
 * room reads as a real space you are looking into. No WebGL, no extra weight.
 * Reduced-motion users get the static composition.
 */
export function RoomBackdrop() {
  const stageRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let px = 0;
    let py = 0;
    let usePointer = false;
    let cx = 0;
    let cy = 0;
    const t0 = performance.now();

    const onMove = (e: PointerEvent) => {
      usePointer = true;
      px = (e.clientX / window.innerWidth - 0.5) * 2;
      py = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      // Pointer when present, otherwise a gentle idle drift.
      const tx = usePointer ? px : Math.sin(t * 0.35) * 0.6;
      const ty = usePointer ? py : Math.cos(t * 0.27) * 0.35;
      cx += (tx - cx) * 0.06;
      cy += (ty - cy) * 0.06;
      stage.style.setProperty("--rx", `${(-cy * 3).toFixed(3)}deg`);
      stage.style.setProperty("--ry", `${(cx * 5).toFixed(3)}deg`);
      stage.style.setProperty("--dx", cx.toFixed(4));
      stage.style.setProperty("--dy", cy.toFixed(4));
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  const layer: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };

  return (
    <div
      ref={stageRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-0"
      style={{ perspective: "1100px", perspectiveOrigin: "50% 45%" }}
    >
      <div
        className="absolute inset-0"
        style={{
          transformStyle: "preserve-3d",
          transform: "rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))",
        }}
      >
        {/* Back: light glows sit furthest away */}
        <div
          style={{
            ...layer,
            transform:
              "translate3d(calc(var(--dx, 0) * -14px), calc(var(--dy, 0) * -10px), -160px) scale(1.3)",
            background:
              "radial-gradient(45% 45% at 62% 30%, rgba(216,255,60,0.2), rgba(124,77,255,0.1) 55%, transparent 80%), radial-gradient(40% 40% at 18% 85%, rgba(255,154,77,0.12), transparent 75%)",
          }}
        />
        {/* Middle: the room shell */}
        <div
          style={{
            ...layer,
            backgroundImage: "url(/room-shell.svg)",
            transform: "translate3d(0, 0, -60px) scale(1.12)",
          }}
        />
        {/* Front: furniture and lamp, closest to the viewer */}
        <div
          style={{
            ...layer,
            backgroundImage: "url(/room-furniture.svg)",
            transform:
              "translate3d(calc(var(--dx, 0) * 22px), calc(var(--dy, 0) * 14px), 70px) scale(1.04)",
            filter: "drop-shadow(0 0 18px rgba(216,255,60,0.25))",
          }}
        />
      </div>

      {/* Soft fade so foreground content stays readable */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 45%, transparent 40%, rgba(10,10,12,0.7) 100%), linear-gradient(to bottom, transparent 50%, rgba(10,10,12,0.85))",
        }}
      />
    </div>
  );
}
