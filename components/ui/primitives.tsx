"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink hover:bg-accent-hover active:translate-y-px",
  secondary: "bg-ink-3 text-chalk hover:bg-ink-4 border border-white/8",
  ghost: "bg-transparent text-chalk-2 hover:text-chalk hover:bg-white/6",
  danger: "bg-danger/12 text-danger hover:bg-danger/20 border border-danger/25",
  outline: "border border-line-strong text-chalk hover:bg-white/[0.045] hover:border-[rgb(236_232_219/0.38)] active:translate-y-px",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[12.5px] gap-1.5 rounded-[9px]",
  md: "h-10 px-4 text-[13.5px] gap-2 rounded-[11px]",
  lg: "h-[46px] px-5 text-[14px] font-[550] gap-2.5 rounded-[13px]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "secondary", size = "md", loading, children, disabled, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center font-medium tracking-[-0.01em]",
          "transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
          "active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-0",
          "whitespace-nowrap select-none",
          VARIANTS[variant],
          SIZES[size],
          className,
        )}
        {...props}
      >
        {loading ? (
          <span className="size-3.5 rounded-full border-2 border-current border-t-transparent animate-spin-slow" />
        ) : null}
        {children}
      </button>
    );
  },
);

/**
 * Button styling for elements that are semantically links.
 *
 * Wrapping an <a> in a <button> nests two interactive roles, which breaks
 * keyboard and screen-reader behaviour — so navigation uses the classes
 * directly on the anchor instead.
 */
export function buttonClasses(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(
    "inline-flex items-center justify-center font-medium tracking-[-0.01em]",
    "transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
    "active:scale-[0.97] select-none whitespace-nowrap",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-0",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

/* ------------------------------------------------------------------ */
/* IconButton                                                          */
/* ------------------------------------------------------------------ */

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  size?: "sm" | "md";
  tone?: "default" | "danger";
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { className, label, active, size = "md", tone = "default", children, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        aria-pressed={active}
        className={cn(
          "relative inline-flex items-center justify-center rounded-[10px]",
          "transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.93]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          "disabled:opacity-35 disabled:pointer-events-none",
          size === "sm" ? "size-8" : "size-10",
          active
            ? "bg-accent text-black"
            : tone === "danger"
              ? "text-chalk-3 hover:text-danger hover:bg-danger/12"
              : "text-chalk-2 hover:text-chalk hover:bg-white/8",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

/* ------------------------------------------------------------------ */
/* Chip                                                                */
/* ------------------------------------------------------------------ */

export function Chip({
  active,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 h-8",
        "text-[12.5px] font-medium tracking-[-0.01em] whitespace-nowrap",
        "transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.96]",
        "border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        active
          ? "bg-chalk text-ink-0 border-transparent"
          : "bg-white/4 text-chalk-2 border-white/8 hover:text-chalk hover:bg-white/8 hover:border-white/16",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control                                                   */
/* ------------------------------------------------------------------ */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
  compact = false,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
  /** Collapse to icons until there is room for labels. Names stay on aria-label. */
  compact?: boolean;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[12px] bg-ink-2 p-1 border border-white/7",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            aria-label={o.label}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative inline-flex items-center justify-center gap-1.5 rounded-[9px] font-medium",
              "transition-all duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
              size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[12.5px]",
              active
                ? "bg-chalk text-ink-0 shadow-[0_2px_10px_-2px_rgba(0,0,0,0.6)]"
                : "text-chalk-3 hover:text-chalk-2",
            )}
          >
            {o.icon}
            <span className={cn(compact && o.icon && "hidden xl:inline")}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Slider with numeric readout                                         */
/* ------------------------------------------------------------------ */

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  onCommit,
  format,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  format?: (v: number) => string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between">
        <label className="text-[11px] uppercase tracking-[0.09em] text-chalk-3 font-medium">
          {label}
        </label>
        <span className="text-[12px] tabular-nums text-chalk-2 font-medium">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="w-full"
        aria-label={label}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function SectionLabel({
  children,
  className,
  action,
}: {
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h3 className="text-[11px] uppercase tracking-[0.11em] text-chalk-3 font-semibold">
        {children}
      </h3>
      {action}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-white/7", className)} />;
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "danger";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 h-[19px] text-[10.5px] font-semibold tracking-[0.02em]",
        tone === "accent" && "bg-accent/15 text-accent",
        tone === "danger" && "bg-danger/15 text-danger",
        tone === "neutral" && "bg-white/8 text-chalk-2",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-4 rounded-full border-2 border-white/20 border-t-accent animate-spin-slow",
        className,
      )}
    />
  );
}

/** Shimmering placeholder used while a panel's data loads. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-[10px] bg-white/5", className)}>
      <div className="absolute inset-0 -translate-x-full animate-sweep bg-gradient-to-r from-transparent via-white/8 to-transparent" />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-14 gap-3",
        className,
      )}
    >
      {icon ? (
        <div className="size-11 rounded-[13px] bg-white/5 grid place-items-center text-chalk-3 mb-1">
          {icon}
        </div>
      ) : null}
      <p className="text-[15px] font-medium text-chalk tracking-[-0.015em]">{title}</p>
      {body ? <p className="text-[13px] text-chalk-3 max-w-[30ch] leading-relaxed">{body}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
