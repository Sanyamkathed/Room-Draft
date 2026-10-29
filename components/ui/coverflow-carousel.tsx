"use client";

import { motion, useReducedMotion } from "motion/react";
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";

export interface CoverflowCarouselItem {
  alt?: string;
  content?: ReactNode;
  id: string;
  image?: string;
  /** Read out for the active slide, and used on the jump-to buttons. */
  label?: string;
}

export interface CoverflowCarouselProps {
  autoplay?: boolean;
  autoplayDelay?: number;
  /** Sizes each card; the stage takes its height from it. */
  cardClassName?: string;
  className?: string;
  depth?: number;
  index?: number;
  inverted?: boolean;
  items: CoverflowCarouselItem[];
  loop?: boolean;
  onIndexChange?: (index: number) => void;
  rotation?: number;
  scaleStep?: number;
  /** Show a row of named buttons under the controls for jumping straight to a slide. */
  showJumpList?: boolean;
  spacing?: number;
  stageClassName?: string;
}

interface DragInfo {
  offset: { x: number; y: number };
  velocity: { x: number; y: number };
}

const DEFAULT_DEPTH = 180;
const DEFAULT_ROTATION = 45;
const DEFAULT_SPACING = 220;
const DEFAULT_SCALE_STEP = 0.15;
const DEFAULT_AUTOPLAY_DELAY = 4000;
const SWIPE_VELOCITY_THRESHOLD = 500;
const SWIPE_DISTANCE_THRESHOLD = 80;
const MAX_VISIBLE_OFFSET = 3;
const MIN_SCALE = 0.4;

/**
 * A 3D coverflow. The centre card is the live one; side cards turn away and
 * step back. Clicking a side card brings it to the centre rather than following
 * any link inside it, so only the card you are looking at navigates.
 */
const CoverflowCarousel = ({
  items,
  index: indexProp,
  onIndexChange,
  inverted = false,
  depth = DEFAULT_DEPTH,
  rotation = DEFAULT_ROTATION,
  spacing = DEFAULT_SPACING,
  scaleStep = DEFAULT_SCALE_STEP,
  loop = false,
  autoplay = false,
  autoplayDelay = DEFAULT_AUTOPLAY_DELAY,
  showJumpList = false,
  className,
  cardClassName,
  stageClassName,
}: CoverflowCarouselProps) => {
  const shouldReduceMotion = useReducedMotion();
  const [internalIndex, setInternalIndex] = useState(0);
  const isControlled = indexProp !== undefined;
  const activeIndex = isControlled ? indexProp : internalIndex;
  const [isPaused, setIsPaused] = useState(false);
  const total = items.length;

  // Narrow screens squeeze the fan so side cards still peek in from the edges.
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Auto-play only while the carousel is on screen: animating it out of
  // sight costs a phone battery and frames for nothing.
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const gap = width ? Math.min(spacing, width * 0.27) : spacing;
  // A phone only shows two cards each side; drawing three in 3D costs frames.
  const visibleOffset = width && width < 640 ? 2 : MAX_VISIBLE_OFFSET;

  // A drag ends with a click on whatever card it started on; swallow that one.
  const draggedRef = useRef(false);

  const goTo = useCallback(
    (next: number) => {
      const clamped = loop
        ? ((next % total) + total) % total
        : Math.min(Math.max(next, 0), total - 1);

      if (!isControlled) {
        setInternalIndex(clamped);
      }
      onIndexChange?.(clamped);
    },
    [isControlled, loop, onIndexChange, total],
  );

  useEffect(() => {
    if (!autoplay || shouldReduceMotion || isPaused || !inView || total <= 1) {
      return;
    }

    const timer = setInterval(() => {
      goTo(activeIndex + 1);
    }, autoplayDelay);

    return () => clearInterval(timer);
  }, [autoplay, shouldReduceMotion, isPaused, inView, activeIndex, autoplayDelay, goTo, total]);

  useEffect(() => {
    const handleVisibility = () => {
      setIsPaused(document.hidden);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(activeIndex + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(activeIndex - 1);
    }
  };

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: DragInfo) => {
    const isSwipeLeft =
      info.offset.x < -SWIPE_DISTANCE_THRESHOLD || info.velocity.x < -SWIPE_VELOCITY_THRESHOLD;
    const isSwipeRight =
      info.offset.x > SWIPE_DISTANCE_THRESHOLD || info.velocity.x > SWIPE_VELOCITY_THRESHOLD;

    if (Math.abs(info.offset.x) > 6) {
      draggedRef.current = true;
      setTimeout(() => (draggedRef.current = false), 0);
    }

    if (isSwipeLeft) {
      goTo(activeIndex + 1);
    } else if (isSwipeRight) {
      goTo(activeIndex - 1);
    }
  };

  const dragEndRef = useRef(handleDragEnd);
  dragEndRef.current = handleDragEnd;

  const onCardClickCapture = (i: number) => (event: ReactMouseEvent) => {
    if (draggedRef.current || i !== activeIndex) {
      event.preventDefault();
      event.stopPropagation();
      if (!draggedRef.current) goTo(i);
    }
  };

  /** Signed distance from the active card, wrapping when looping. */
  const offsetOf = (i: number) => {
    let offset = i - activeIndex;
    if (loop && total > 1) {
      if (offset > total / 2) offset -= total;
      if (offset < -total / 2) offset += total;
    }
    return offset;
  };

  return (
    <div
      ref={rootRef}
      aria-label="Coverflow carousel"
      aria-roledescription="carousel"
      className={cn("relative w-full select-none rounded-[var(--radius-card)] outline-none", className)}
      onBlur={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      role="region"
      tabIndex={0}
    >
      <motion.div
        className={cn(
          "relative mx-auto flex h-[400px] cursor-grab items-center justify-center overflow-x-clip active:cursor-grabbing",
          stageClassName,
        )}
        drag={total > 1 && !shouldReduceMotion ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.12}
        onDragEnd={(event, info) => dragEndRef.current(event, info)}
        // Perspective lives on the stage: it clips sideways overflow, which
        // would flatten any 3D context inherited from further up.
        style={{ perspective: shouldReduceMotion ? undefined : 1200 }}
      >
        {items.map((item, i) => {
          const offset = offsetOf(i);
          // One card beyond the visible fan stays mounted (and transparent) so its
          // photo is already decoded when it slides in, instead of popping in mid-swipe.
          const isVisible = Math.abs(offset) <= visibleOffset;
          const isMounted = Math.abs(offset) <= visibleOffset + 1;
          const isActive = offset === 0;

          if (!isMounted) {
            return null;
          }

          const direction = inverted ? -1 : 1;
          // Classic coverflow: every side card turns by the same angle, so the
          // outer ones stay readable instead of going edge-on.
          const rotateY = shouldReduceMotion
            ? 0
            : direction * -Math.sign(offset) * Math.min(Math.abs(offset), 1) * rotation;
          const translateX = offset * gap;
          const translateZ = shouldReduceMotion ? 0 : -Math.abs(offset) * depth;
          const scale = Math.max(1 - Math.abs(offset) * scaleStep, MIN_SCALE);

          return (
            <motion.div
              animate={
                shouldReduceMotion
                  ? { opacity: isActive ? 1 : 0, x: translateX }
                  : {
                      opacity: isVisible ? 1 : 0,
                      rotateY,
                      scale,
                      x: translateX,
                      z: translateZ,
                    }
              }
              aria-hidden={!isActive}
              className={cn(
                // A big blurred shadow on every moving card is what makes phones
                // drop frames; only the centre card, which settles, carries one.
                "absolute h-[340px] w-[270px] overflow-hidden rounded-[var(--radius-card)] border border-line bg-ink-2 [backface-visibility:hidden] will-change-transform",
                isActive ? "border-line-strong shadow-[0_18px_40px_rgba(0,0,0,0.3)]" : "cursor-pointer",
                !isVisible && "pointer-events-none",
                cardClassName,
              )}
              initial={false}
              key={item.id}
              onClickCapture={onCardClickCapture(i)}
              style={{ zIndex: total - Math.abs(offset) }}
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { type: "tween", duration: 0.42, ease: [0.22, 1, 0.36, 1] }
              }
            >
              <div inert={!isActive} className="h-full w-full">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={item.alt ?? ""}
                    className="h-full w-full object-cover"
                    draggable={false}
                    src={item.image}
                  />
                ) : (
                  item.content
                )}
              </div>
              {/* Side cards recede into the charcoal rather than turning see-through */}
              <motion.div
                aria-hidden
                animate={{ opacity: Math.min(Math.abs(offset) * 0.28, 0.75) }}
                className="pointer-events-none absolute inset-0 bg-ink-1"
                initial={false}
                transition={{ type: "tween", duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
              />
            </motion.div>
          );
        })}
      </motion.div>

      <div className="mt-5 flex items-center justify-center gap-3">
        <Button
          aria-label="Previous slide"
          className="rounded-full"
          disabled={!loop && activeIndex === 0}
          onClick={() => goTo(activeIndex - 1)}
          size="sm"
          variant="outline"
        >
          <ChevronLeft className="size-4" />
          Prev
        </Button>
        <span className="min-w-[4.5ch] text-center text-[12px] tabular-nums text-chalk-3">
          {activeIndex + 1} / {total}
        </span>
        <Button
          aria-label="Next slide"
          className="rounded-full"
          disabled={!loop && activeIndex === total - 1}
          onClick={() => goTo(activeIndex + 1)}
          size="sm"
          variant="outline"
        >
          Next
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {showJumpList && (
        <div className="mx-auto mt-6 flex max-w-[900px] flex-wrap justify-center gap-2">
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              aria-current={i === activeIndex ? "true" : undefined}
              onClick={() => goTo(i)}
              className={cn(
                "h-8 rounded-full border px-3 text-[12px] font-medium transition-colors",
                i === activeIndex
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-line text-chalk-2 hover:border-line-strong hover:text-chalk",
              )}
            >
              {item.label ?? `Slide ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      <div aria-live="polite" className="sr-only">
        {`Slide ${activeIndex + 1} of ${total}${items[activeIndex]?.label ? `: ${items[activeIndex].label}` : ""}`}
      </div>
    </div>
  );
};

export default CoverflowCarousel;
