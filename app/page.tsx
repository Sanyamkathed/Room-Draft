"use client";

import Link from "next/link";
import {
  ArrowRight,
  Box,
  Camera,
  Focus,
  Plus,
  Ruler,
  Sofa,
} from "lucide-react";
import { PRODUCTS_BY_ID } from "@/lib/catalog/seed";
import { useProjects } from "@/lib/hooks/useProjects";
import { Skeleton, buttonClasses } from "@/components/ui/primitives";
import { AestheticCarousel } from "@/components/shell/AestheticCarousel";
import { ProjectCard } from "@/components/shell/ProjectCard";
import { ProductThumb } from "@/components/studio/ProductThumb";
import { TrySampleRoom } from "@/components/shell/TrySampleRoom";

/**
 * Pieces called out over the hero render. Positions are percentages of the
 * image itself, so the tags stay on their furniture however the image is
 * cropped.
 */
const HERO_TAGS = [
  { id: "floor-lamp-tripod", x: 42.4, y: 33, side: "above" },
  { id: "chair-velvet", x: 35, y: 56, side: "above" },
  { id: "coffee-table-round", x: 50.5, y: 63, side: "below" },
] as const;

function SectionHeading({
  title,
  sub,
  action,
  id,
}: {
  title: string;
  sub?: string;
  action?: { href: string; label: string };
  id?: string;
}) {
  return (
    <header className="mb-6 flex flex-col items-start justify-between gap-3 md:flex-row md:items-end md:gap-6">
      <div>
        <h2
          id={id}
          className="font-[family-name:var(--font-display)] text-[clamp(34px,3.8vw,54px)] font-bold leading-[0.98] tracking-[-0.04em] text-chalk"
        >
          {title}
        </h2>
        {sub && <p className="mt-2 text-[14px] text-chalk-3">{sub}</p>}
      </div>
      {action && (
        <Link
          href={action.href}
          className="group inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-accent transition-colors hover:text-accent-hover"
        >
          {action.label}
          <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
        </Link>
      )}
    </header>
  );
}

export default function HomePage() {
  const { projects, loading, remove } = useProjects();
  const recent = projects?.slice(0, 4) ?? [];

  return (
    <div>
      {/* ---------------- Hero ---------------- */}
      <section className="relative isolate flex min-h-[720px] items-end overflow-hidden [container-type:inline-size] md:min-h-[clamp(560px,45vw,700px)] md:items-center">
        {/* The hero's whole backdrop fades out at the bottom, so it dissolves
            into the page's aurora instead of ending on a hard edge. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-ink-0 [mask-image:linear-gradient(to_bottom,black_72%,transparent_100%)]"
        >
        {/* The render and its tags share one box with the image's own aspect
            ratio, sized to cover the hero, so tags track the furniture. */}
        <div
          aria-hidden
          className="absolute left-1/2 top-0 -z-20 aspect-[1920/1023] w-[max(100cqw,640px)] -translate-x-[58%] md:w-[max(100cqw,1320px)] md:left-0 md:top-0 md:translate-x-[14%]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hero/room.jpg"
            alt=""
            className="absolute inset-0 size-full object-cover"
            fetchPriority="high"
          />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(0deg,rgba(36,31,26,1)_0%,rgba(36,31,26,0.89)_46%,rgba(36,31,26,0.16)_100%),linear-gradient(90deg,rgba(36,31,26,0.35),transparent)] md:bg-[linear-gradient(90deg,rgba(36,31,26,0.98)_0%,rgba(36,31,26,0.91)_26%,rgba(36,31,26,0.56)_48%,rgba(36,31,26,0.08)_76%)]"
        />
        {/* The render melts into the page colour, so the sections below read
            as the same room rather than a new band */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[55%] bg-[linear-gradient(to_top,var(--color-ink-0)_0%,var(--color-ink-0)_14%,rgba(36,31,26,0.82)_42%,transparent_100%)]"
        />
        </div>

        {/* Product callouts, desktop only — on a phone they would sit under the copy */}
        <div className="absolute left-0 top-0 hidden aspect-[1920/1023] w-[max(100cqw,1320px)] translate-x-[14%] lg:block">
          {HERO_TAGS.map(({ id, x, y, side }) => {
            const p = PRODUCTS_BY_ID.get(id);
            if (!p) return null;
            return (
              <div
                key={id}
                className="absolute"
                style={{ left: `${x}%`, top: `${y}%` }}
              >
                <span className="absolute -left-[7px] -top-[7px] grid size-[14px] place-items-center rounded-full border-2 border-accent bg-ink-1/60">
                  <span className="size-1 rounded-full bg-accent" />
                </span>
                <span
                  className={
                    side === "above"
                      ? "absolute bottom-[7px] left-0 h-9 w-px bg-white/30"
                      : "absolute left-0 top-[7px] h-9 w-px bg-white/30"
                  }
                />
                <Link
                  href={`/shop?item=${encodeURIComponent(p.id)}`}
                  className={`group absolute left-[-12px] inline-flex items-center gap-2.5 whitespace-nowrap rounded-[12px] border border-white/20 bg-[rgba(35,31,27,0.86)] py-2 pl-2 pr-3 text-chalk shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-[12px] transition-colors hover:border-white/35 ${
                    side === "above" ? "bottom-[43px]" : "top-[43px]"
                  }`}
                >
                  <ProductThumb product={p} className="size-[38px] rounded-[8px]" />
                  <span className="text-[12.5px] font-medium leading-tight">{p.name}</span>
                  <ArrowRight className="ml-1 size-3.5 text-chalk-2 transition-transform duration-300 group-hover:translate-x-0.5" />
                </Link>
              </div>
            );
          })}
        </div>

        <div className="relative w-full px-[22px] pb-[34px] pt-[260px] md:w-[min(720px,72%)] md:px-[clamp(28px,5vw,80px)] md:py-[clamp(42px,6vw,88px)] lg:w-[min(840px,60%)]">
          <h1 className="mb-5 max-w-[680px] font-[family-name:var(--font-display)] text-[clamp(46px,12.5vw,64px)] font-bold leading-[0.92] tracking-[-0.04em] text-chalk md:text-[clamp(48px,4.9vw,76px)]">
            Design your space
            <br />
            <span className="text-warm">before you buy it.</span>
          </h1>

          <p className="max-w-[510px] text-[clamp(15px,1.25vw,18px)] leading-[1.7] text-chalk-2">
            Upload a photo of your room, try furniture and decor in 3D, and discover
            pieces that actually fit your space.
          </p>

          <div className="mt-[30px] flex flex-col gap-3 min-[421px]:flex-row min-[421px]:flex-wrap">
            <Link href="/onboarding" className={buttonClasses("primary", "lg", "group")}>
              <Camera className="size-[17px]" strokeWidth={2} />
              Upload your room
              <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </Link>
            <TrySampleRoom />
          </div>

          <dl className="mt-[30px] flex flex-wrap gap-[18px] md:mt-11 md:gap-7">
            {[
              { icon: Box, k: "Real scale", v: "Every item sized in cm" },
              { icon: Focus, k: "Snap + collide", v: "Nothing floats or clips" },
              { icon: Sofa, k: "100+ curated pieces", v: "Built for real spaces" },
            ].map(({ icon: Icon, k, v }) => (
              <div key={k} className="flex min-w-[125px] items-start gap-2.5 md:min-w-[135px]">
                <Icon className="mt-0.5 size-[18px] shrink-0 text-warm" strokeWidth={1.6} />
                <div>
                  <dt className="text-[13px] font-semibold text-chalk">{k}</dt>
                  <dd className="mt-[3px] text-[12px] text-chalk-3">{v}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="mx-auto w-[min(calc(100%-32px),1440px)] md:w-[min(calc(100%-64px),1440px)]">
        {/* ---------------- Aesthetics ---------------- */}
        <section className="pt-[clamp(48px,6vw,88px)]">
          <SectionHeading
            title="Explore aesthetics"
            sub="Pick a direction and we'll recommend around it"
            action={{ href: "/discover", label: "View all styles" }}
          />

          <AestheticCarousel autoplay />
        </section>

        {/* ---------------- How it works ---------------- */}
        <section className="scroll-mt-24 pt-[clamp(48px,6vw,88px)]" id="how-it-works" aria-labelledby="how-it-works-title">
          <SectionHeading
            id="how-it-works-title"
            title="How RoomDraft works"
            sub="See decor in your own room before you spend a rupee"
          />

          {/* A sequence, so the numbers carry meaning: read left to right, top to bottom on a phone */}
          <ol className="grid border-t border-line md:grid-cols-3">
            {[
              {
                title: "Upload a photo",
                body: "One picture of your room. Nothing leaves your device unless you choose.",
              },
              {
                title: "We rebuild it in 3D",
                body: "RoomDraft works out the walls, floor and size, so everything you add is true to scale.",
              },
              {
                title: "Drop in decor",
                body: "Lamps, posters, plants, furniture. They sit on tables and hang on walls.",
              },
            ].map(({ title, body }, i) => (
              <li
                key={title}
                className="flex gap-5 border-b border-line py-7 md:border-b-0 md:border-l md:px-8 md:py-9 md:first:border-l-0 md:first:pl-0"
              >
                <span
                  aria-hidden
                  className="font-[family-name:var(--font-display)] text-[56px] font-bold leading-[0.8] tracking-[-0.04em] text-warm tabular-nums"
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-[17px] font-semibold tracking-[-0.02em]">{title}</h3>
                  <p className="mt-2 max-w-[38ch] text-[14px] leading-relaxed text-chalk-3">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------------- Continue designing ---------------- */}
        <section className="pb-[clamp(48px,6vw,88px)] pt-[clamp(48px,6vw,88px)]">
          <SectionHeading
            title="Continue designing"
            sub="Pick up where you left off"
            action={recent.length > 0 ? { href: "/spaces", label: "All spaces" } : undefined}
          />

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="aspect-[4/3]" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <Link
              href="/onboarding"
              className="group grid min-h-[250px] place-items-center rounded-[24px] border border-dashed border-accent/45 bg-ink-2 p-8 text-center transition-colors duration-200 hover:border-accent hover:bg-ink-3"
            >
              <div>
                <div className="mx-auto mb-3.5 grid size-12 place-items-center rounded-[14px] bg-accent text-accent-ink">
                  <Plus className="size-5" strokeWidth={2.2} />
                </div>
                <h3 className="text-[16px] font-semibold">Create your first space</h3>
                <p className="mt-[7px] text-[13px] text-chalk-3">
                  One photo is enough to get started
                </p>
              </div>
            </Link>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {recent.map((p) => (
                <ProjectCard key={p.id} project={p} onDelete={remove} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
