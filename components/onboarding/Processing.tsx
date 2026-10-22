"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const STAGES = [
  { key: "map", label: "Mapping your space", detail: "Finding edges and surfaces" },
  { key: "dims", label: "Understanding dimensions", detail: "Solving the perspective" },
  { key: "build", label: "Building your room", detail: "Fitting walls, floor and ceiling" },
  { key: "prep", label: "Preparing your 3D environment", detail: "Lighting and materials" },
] as const;

/**
 * The processing screen.
 *
 * The analysis it narrates is real, and how long it takes depends on who is
 * doing it: the local perspective solve is ~40ms, the depth and detection
 * service a second or two. So the stages advance on a timer for readability,
 * but the screen does not *leave* until the work reports itself finished --
 * `ready` gates the final step.
 *
 * That ordering matters. A fixed timer was correct while the only analysis
 * took 40ms; the moment a slower path exists the same timer would advance to
 * corner-marking with nothing solved, handing the user a default quad to drag
 * instead of the answer that was a second away.
 *
 * The scan line sweeps the user's actual photo, which is also what is being
 * analysed.
 */
export function Processing({
  imageUrl,
  onDone,
  ready = true,
  note,
}: {
  imageUrl: string;
  onDone: () => void;
  /** Whether the underlying analysis has finished. Holds the last stage. */
  ready?: boolean;
  /** What is actually happening, when it is worth naming. */
  note?: string;
}) {
  const [stage, setStage] = React.useState(0);
  const left = React.useRef(false);

  React.useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Never tick past the final stage on time alone.
    STAGES.slice(0, -1).forEach((_, i) => {
      timers.push(setTimeout(() => setStage(i + 1), 520 + i * 560));
    });
    return () => timers.forEach(clearTimeout);
  }, []);

  React.useEffect(() => {
    if (!ready || left.current) return;
    left.current = true;
    // Let the last stage land before moving on, so the sequence reads as
    // finished rather than interrupted.
    const settle = setTimeout(() => setStage(STAGES.length), 240);
    const leave = setTimeout(onDone, 700);
    return () => {
      clearTimeout(settle);
      clearTimeout(leave);
    };
  }, [ready, onDone]);

  return (
    <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
      <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-ink-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Your uploaded space"
          className="w-full object-cover"
          style={{ maxHeight: "58vh" }}
        />

        {/* Scan sweep */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute inset-x-0 h-24 animate-[scan_2.6s_cubic-bezier(0.65,0,0.35,1)_infinite]"
            style={{
              background:
                "linear-gradient(to bottom, transparent, rgba(216,255,60,0.16) 45%, rgba(216,255,60,0.55) 50%, rgba(216,255,60,0.16) 55%, transparent)",
            }}
          />
        </div>

        {/* Corner reticles — reads as "measuring", which is what is happening */}
        {[
          "left-4 top-4 border-l-2 border-t-2",
          "right-4 top-4 border-r-2 border-t-2",
          "left-4 bottom-4 border-l-2 border-b-2",
          "right-4 bottom-4 border-r-2 border-b-2",
        ].map((pos, i) => (
          <span
            key={i}
            className={cn("absolute size-7 border-accent/70 animate-breathe", pos)}
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/25" />
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-[0.12em] text-accent font-semibold">
          Reconstructing
        </p>
        <h2 className="text-display mt-3 text-[34px] md:text-[42px]">
          Building your room
        </h2>

        <ol className="mt-8 space-y-1">
          {STAGES.map((s, i) => {
            const done = stage > i;
            const active = stage === i;
            return (
              <li
                key={s.key}
                className={cn(
                  "flex items-start gap-3.5 rounded-[13px] px-3 py-3 transition-all duration-500",
                  active && "bg-white/5",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border transition-all duration-400",
                    done && "border-accent bg-accent text-black",
                    active && !done && "border-accent/50",
                    !done && !active && "border-white/12",
                  )}
                >
                  {done ? (
                    <Check className="size-3.5" strokeWidth={3} />
                  ) : active ? (
                    <span className="size-2 rounded-full bg-accent animate-breathe" />
                  ) : null}
                </span>

                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-[14px] font-medium tracking-[-0.015em] transition-colors duration-400",
                      done || active ? "text-chalk" : "text-chalk-4",
                    )}
                  >
                    {s.label}
                  </span>
                  <span
                    className={cn(
                      "block text-[12.5px] transition-colors duration-400",
                      active ? "text-chalk-3" : "text-chalk-4/70",
                    )}
                  >
                    {s.detail}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        {note && (
          <p className="mt-5 px-3 text-[12.5px] leading-relaxed text-chalk-3">{note}</p>
        )}
      </div>

      <style jsx global>{`
        @keyframes scan {
          0% {
            transform: translateY(-6rem);
          }
          100% {
            transform: translateY(calc(58vh + 6rem));
          }
        }
      `}</style>
    </div>
  );
}
