"use client";

import React, { useRef } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { cn } from "@/lib/utils/cn";

// Drag and animation handlers mean something different on a motion element.
type DivProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
>;

export interface GlareCardProps extends DivProps {
  children: React.ReactNode;
  glareColor?: string;
  tiltIntensity?: number;
}

/**
 * A card that tilts toward the pointer with a soft glare and a light streak
 * along its edge, like light catching a glossy surface.
 *
 * Every effect is driven by motion values, so the card re-renders zero times
 * while the pointer moves. It only reacts to a mouse or pen: on a touch
 * screen a tilt would fight the scroll, so phones get the plain card.
 */
const GlareCard = React.forwardRef<HTMLDivElement, GlareCardProps>(
  (
    {
      children,
      className,
      glareColor = "rgba(241,230,210,0.22)",
      tiltIntensity = 8,
      ...props
    },
    ref,
  ) => {
    const internalRef = useRef<HTMLDivElement | null>(null);
    const prefersReducedMotion = useReducedMotion();

    // Pointer position across the card, -1..1 on each axis.
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);
    const springConfig = { damping: 25, stiffness: 150, mass: 0.6 };
    const springX = useSpring(mouseX, springConfig);
    const springY = useSpring(mouseY, springConfig);

    const rotateX = useTransform(springY, (v) => v * -tiltIntensity);
    const rotateY = useTransform(springX, (v) => v * tiltIntensity);
    const glareX = useTransform(springX, (v) => 50 + v * 50);
    const glareY = useTransform(springY, (v) => 50 + v * 50);
    const edgeX = useTransform(springX, (v) => 50 + v * 25);
    const edgeY = useTransform(springY, (v) => 50 + v * 25);
    const shimmerX = useTransform(springX, (v) => `${v * -20}%`);

    const backgroundGlare = useMotionTemplate`radial-gradient(circle at ${glareX}% ${glareY}%, ${glareColor} 0%, transparent 70%)`;
    const borderHighlight = useMotionTemplate`conic-gradient(from 0deg at ${edgeX}% ${edgeY}%, transparent, ${glareColor}, transparent)`;

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!internalRef.current || prefersReducedMotion || e.pointerType === "touch") return;
      const rect = internalRef.current.getBoundingClientRect();
      mouseX.set((e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2));
      mouseY.set((e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2));
    };
    const handlePointerLeave = () => {
      mouseX.set(0);
      mouseY.set(0);
    };

    return (
      <motion.div
        ref={(node) => {
          internalRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        style={{
          rotateX: prefersReducedMotion ? 0 : rotateX,
          rotateY: prefersReducedMotion ? 0 : rotateY,
          transformPerspective: 900,
        }}
        className={cn(
          "group relative isolate overflow-hidden rounded-[var(--radius-card)] border border-line bg-ink-2/80 backdrop-blur-md transition-[border-color,box-shadow] duration-500",
          "hover:border-line-strong hover:shadow-[0_18px_44px_-14px_rgba(0,0,0,0.7)]",
          className,
        )}
        {...props}
      >
        {/* Light streak along the edge, following the pointer */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-30 rounded-[inherit] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background: borderHighlight,
            padding: "1px",
            WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
          }}
        />
        {/* Soft glare across the surface */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 opacity-0 mix-blend-soft-light transition-opacity duration-500 group-hover:opacity-100"
          style={{ background: backgroundGlare }}
        />
        {/* Faint sheen that drifts opposite the tilt */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-[-50%] z-0 rotate-[15deg] opacity-0 transition-opacity duration-700 group-hover:opacity-[0.07]"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(255,250,241,0.5), transparent)",
            x: shimmerX,
          }}
        />
        <div className="relative z-10 h-full w-full">{children}</div>
      </motion.div>
    );
  },
);

GlareCard.displayName = "GlareCard";

export { GlareCard };
