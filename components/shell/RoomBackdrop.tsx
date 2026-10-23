"use client";

import * as React from "react";

/**
 * A live 3D room rendered with CSS transforms (no WebGL, no extra bundle).
 *
 * The camera sits inside a wireframe room. The back wall carries the AURA
 * wordmark and tagline "painted" on it, with a window casting light across the
 * floor, a floating shelf, and a desk with a glowing lamp on top — a nod to the
 * thing the app actually does. The whole room tilts gently with the pointer.
 * Reduced-motion users get the static view.
 */

const W = 960; // room width  (px, before scaling)
const H = 540; // room height
const D = 1000; // room depth

const LINE = "rgba(255,255,255,0.13)";
const LINE_ACCENT = "rgba(216,255,60,0.38)";

type BoxProps = {
  x: number; // centre, from room centre (+right)
  y: number; // centre, from room centre (+down)
  z: number; // centre, from room centre (+toward camera)
  w: number;
  h: number;
  d: number;
  stroke?: string;
  fill?: string;
  glow?: string;
};

/** A six-faced wireframe box positioned in room space. */
function Box({ x, y, z, w, h, d, stroke = LINE, fill = "rgba(10,10,12,0.55)", glow }: BoxProps) {
  const face: React.CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    border: `1px solid ${stroke}`,
    background: fill,
    boxShadow: glow ? `0 0 38px ${glow}` : undefined,
  };
  return (
    <div
      className="absolute left-1/2 top-1/2"
      style={{ transformStyle: "preserve-3d", transform: `translate3d(${x}px, ${y}px, ${z}px)` }}
    >
      <div style={{ ...face, width: w, height: h, marginLeft: -w / 2, marginTop: -h / 2, transform: `translateZ(${d / 2}px)` }} />
      <div style={{ ...face, width: w, height: h, marginLeft: -w / 2, marginTop: -h / 2, transform: `translateZ(${-d / 2}px)` }} />
      <div style={{ ...face, width: d, height: h, marginLeft: -d / 2, marginTop: -h / 2, transform: `translateX(${-w / 2}px) rotateY(90deg)` }} />
      <div style={{ ...face, width: d, height: h, marginLeft: -d / 2, marginTop: -h / 2, transform: `translateX(${w / 2}px) rotateY(90deg)` }} />
      <div style={{ ...face, width: w, height: d, marginLeft: -w / 2, marginTop: -d / 2, transform: `translateY(${-h / 2}px) rotateX(90deg)` }} />
      <div style={{ ...face, width: w, height: d, marginLeft: -w / 2, marginTop: -d / 2, transform: `translateY(${h / 2}px) rotateX(90deg)` }} />
    </div>
  );
}

const gridBg = (size: number) =>
  `linear-gradient(${LINE} 1px, transparent 1px) 0 0 / ${size}px ${size}px, linear-gradient(90deg, ${LINE} 1px, transparent 1px) 0 0 / ${size}px ${size}px`;

export function RoomBackdrop() {
  const stageRef = React.useRef<HTMLDivElement>(null);
  const roomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const stage = stageRef.current;
    const room = roomRef.current;
    if (!stage || !room) return;

    const fit = () => {
      const k = Math.min(1.1, Math.max(0.5, window.innerWidth / 1180));
      stage.style.setProperty("--k", String(k));
    };
    fit();
    window.addEventListener("resize", fit);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;

    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ty = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    const tick = () => {
      cx += (tx - cx) * 0.05;
      cy += (ty - cy) * 0.05;
      room.style.transform = `translateZ(430px) rotateX(${(-cy * 3.5).toFixed(3)}deg) rotateY(${(cx * 7).toFixed(3)}deg)`;
      raf = requestAnimationFrame(tick);
    };

    if (!reduce) {
      window.addEventListener("pointermove", onMove, { passive: true });
      raf = requestAnimationFrame(tick);
    }

    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  const wall: React.CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    backfaceVisibility: "hidden",
  };

  return (
    <div
      ref={stageRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-0"
      style={{ perspective: "1250px", perspectiveOrigin: "50% 46%" }}
    >
      <div
        ref={roomRef}
        className="absolute left-1/2 top-1/2"
        style={{
          width: 0,
          height: 0,
          transformStyle: "preserve-3d",
          transform: "translateZ(430px)",
          scale: "var(--k, 1)",
        }}
      >
        {/* ---------- Back wall ---------- */}
        <div
          style={{
            ...wall,
            width: W,
            height: H,
            marginLeft: -W / 2,
            marginTop: -H / 2,
            transform: `translateZ(${-D / 2}px)`,
            background:
              "radial-gradient(60% 70% at 66% 30%, rgba(216,255,60,0.13), rgba(124,77,255,0.07) 55%, transparent 80%), #0b0b0e",
            border: `1px solid ${LINE}`,
          }}
        >
          {/* Wordmark painted on the wall */}
          <div className="absolute right-[6%] top-[12%] select-none text-right">
            <div
              className="font-semibold leading-none tracking-[-0.05em]"
              style={{
                fontSize: 124,
                color: "transparent",
                WebkitTextStroke: `1.5px ${LINE_ACCENT}`,
                textShadow: "0 0 60px rgba(216,255,60,0.18)",
              }}
            >
              AURA
            </div>
            <div
              className="mt-4 flex items-center justify-end gap-3 font-mono text-[12px] uppercase tracking-[0.3em]"
              style={{ color: "rgba(255,255,255,0.4)" }}
            >
              <span className="h-px w-10" style={{ background: LINE_ACCENT }} />
              Place · Light · Live
            </div>
          </div>

          {/* Window with light beam */}
          <div
            className="absolute left-[8%] top-[14%] h-[34%] w-[17%]"
            style={{
              border: `1px solid ${LINE}`,
              background:
                "linear-gradient(160deg, rgba(124,77,255,0.16), rgba(216,255,60,0.06))",
            }}
          >
            <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: LINE }} />
            <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: LINE }} />
          </div>

          {/* Measurement ticks along the wall base */}
          <div
            className="absolute inset-x-0 bottom-0 h-[10px] opacity-70"
            style={{
              background: `repeating-linear-gradient(90deg, ${LINE} 0 1px, transparent 1px 48px)`,
            }}
          />
        </div>

        {/* ---------- Floor ---------- */}
        <div
          style={{
            ...wall,
            width: W,
            height: D,
            marginLeft: -W / 2,
            marginTop: -D / 2,
            transform: `translateY(${H / 2}px) rotateX(90deg)`,
            background: `${gridBg(80)}, radial-gradient(40% 45% at 62% 40%, rgba(216,255,60,0.12), transparent 70%), #0a0a0d`,
          }}
        />
        {/* Light pool from the window */}
        <div
          style={{
            ...wall,
            width: 300,
            height: 420,
            marginLeft: -150 + 250,
            marginTop: -210 - 120,
            transform: `translateY(${H / 2 - 1}px) rotateX(90deg) skewX(-12deg)`,
            background:
              "linear-gradient(to bottom, rgba(216,255,60,0.14), rgba(124,77,255,0.05) 70%, transparent)",
            clipPath: "polygon(8% 0, 100% 0, 88% 100%, 0 100%)",
          }}
        />

        {/* ---------- Ceiling ---------- */}
        <div
          style={{
            ...wall,
            width: W,
            height: D,
            marginLeft: -W / 2,
            marginTop: -D / 2,
            transform: `translateY(${-H / 2}px) rotateX(-90deg)`,
            background: `${gridBg(120)}, #09090b`,
            opacity: 0.8,
          }}
        />

        {/* ---------- Side walls ---------- */}
        <div
          style={{
            ...wall,
            width: D,
            height: H,
            marginLeft: -D / 2,
            marginTop: -H / 2,
            transform: `translateX(${-W / 2}px) rotateY(90deg)`,
            background: `${gridBg(100)}, #0a0a0d`,
          }}
        />
        <div
          style={{
            ...wall,
            width: D,
            height: H,
            marginLeft: -D / 2,
            marginTop: -H / 2,
            transform: `translateX(${W / 2}px) rotateY(-90deg)`,
            background: `${gridBg(100)}, #0a0a0d`,
          }}
        />

        {/* ---------- Furniture ---------- */}
        {/* Floating shelf on the back wall */}
        <Box x={190} y={-10} z={-D / 2 + 60} w={260} h={10} d={110} stroke={LINE_ACCENT} />
        {/* Desk: top slab + legs */}
        <Box x={190} y={H / 2 - 150} z={-D / 2 + 230} w={380} h={14} d={190} stroke={LINE_ACCENT} />
        <Box x={20} y={H / 2 - 75} z={-D / 2 + 300} w={12} h={150} d={12} />
        <Box x={360} y={H / 2 - 75} z={-D / 2 + 300} w={12} h={150} d={12} />
        <Box x={20} y={H / 2 - 75} z={-D / 2 + 160} w={12} h={150} d={12} />
        <Box x={360} y={H / 2 - 75} z={-D / 2 + 160} w={12} h={150} d={12} />
        {/* Lamp on the desk — the thing the placement fix is about */}
        <Box x={190} y={H / 2 - 165} z={-D / 2 + 230} w={20} h={16} d={20} stroke={LINE_ACCENT} />
        <Box
          x={190}
          y={H / 2 - 205}
          z={-D / 2 + 230}
          w={46}
          h={52}
          d={46}
          stroke="rgba(216,255,60,0.7)"
          fill="rgba(216,255,60,0.12)"
          glow="rgba(216,255,60,0.55)"
        />
        {/* Rug */}
        <div
          style={{
            ...wall,
            width: 420,
            height: 300,
            marginLeft: -210 - 150,
            marginTop: -150 + 180,
            transform: `translateY(${H / 2 - 1}px) rotateX(90deg)`,
            border: `1px solid ${LINE_ACCENT}`,
            background: "rgba(124,77,255,0.06)",
          }}
        />
      </div>

      {/* Vignette keeps foreground content readable */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 45%, transparent 35%, rgba(10,10,12,0.78) 100%), linear-gradient(to bottom, transparent 55%, rgba(10,10,12,0.8))",
        }}
      />
    </div>
  );
}
