"use client";

import Link from "next/link";
import { ArrowRight, Camera, Plus, Sparkles } from "lucide-react";
import { AESTHETICS } from "@/lib/catalog/types";
import { PRODUCTS, PRODUCT_COUNT } from "@/lib/catalog/seed";
import { formatINR } from "@/lib/catalog/source";
import { useProjects } from "@/lib/hooks/useProjects";
import { Badge, Skeleton, buttonClasses } from "@/components/ui/primitives";
import { MoodTile } from "@/components/shell/MoodTile";
import { ProjectCard } from "@/components/shell/ProjectCard";

export default function HomePage() {
  const { projects, loading, remove } = useProjects();
  const recent = projects?.slice(0, 4) ?? [];
  const featured = PRODUCTS.filter((p) => p.emissive).slice(0, 6);

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-10 md:py-12">
      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden rounded-[28px] border border-white/8 bg-ink-1 grain">
        <div
          className="pointer-events-none absolute -right-24 -top-24 size-[460px] rounded-full blur-[90px] opacity-45 animate-breathe"
          style={{
            background:
              "radial-gradient(circle, rgba(216,255,60,0.28) 0%, rgba(124,77,255,0.18) 45%, transparent 70%)",
          }}
        />

        <div className="relative px-6 py-12 md:px-14 md:py-20">
          <Badge tone="accent" className="mb-6">
            <Sparkles className="size-3" /> 3D from one photo
          </Badge>

          <h1 className="text-display text-[42px] leading-[0.95] md:text-[76px] max-w-[16ch]">
            Design your space
            <br />
            <span className="text-chalk-3">before you buy it.</span>
          </h1>

          <p className="mt-6 max-w-[52ch] text-[15px] leading-relaxed text-chalk-2 md:text-[16.5px]">
            Upload a photo of your room. AURA measures it, rebuilds it in 3D, and lets
            you drop in neon, posters, plants and figures that scale to their real
            centimetres and snap where they belong.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/onboarding"
              className={buttonClasses("primary", "lg", "group gap-2.5")}
            >
              <Camera className="size-[18px]" strokeWidth={2.2} />
              Upload your room
              <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </Link>
            <Link href="/discover" className={buttonClasses("outline", "lg")}>
              Browse aesthetics
            </Link>
          </div>

          <dl className="mt-12 flex flex-wrap gap-x-10 gap-y-4 border-t border-white/7 pt-7">
            {[
              ["Real scale", "Every item sized in cm"],
              ["Snap + collide", "Nothing floats or clips"],
              [`${PRODUCT_COUNT} curated pieces`, "Built for small spaces"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[13px] font-medium text-chalk tracking-[-0.01em]">{k}</dt>
                <dd className="text-[12.5px] text-chalk-3 mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ---------------- Continue designing ---------------- */}
      <section className="mt-14">
        <header className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.025em]">
              Continue designing
            </h2>
            <p className="mt-1 text-[13px] text-chalk-3">Pick up where you left off</p>
          </div>
          {recent.length > 0 && (
            <Link
              href="/spaces"
              className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-chalk-2 transition-colors hover:text-chalk"
            >
              All spaces
              <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
            </Link>
          )}
        </header>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-[4/3]" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <Link
            href="/onboarding"
            className="group flex aspect-[16/7] w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-white/12 bg-ink-1/50 transition-all duration-300 hover:border-accent/40 hover:bg-ink-1"
          >
            <div className="grid size-12 place-items-center rounded-[14px] bg-white/6 text-chalk-2 transition-all duration-300 group-hover:bg-accent group-hover:text-black">
              <Plus className="size-5" strokeWidth={2.2} />
            </div>
            <p className="text-[14px] font-medium">Create your first space</p>
            <p className="text-[12.5px] text-chalk-3">
              One photo is enough to get started
            </p>
          </Link>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recent.map((p) => (
              <ProjectCard key={p.id} project={p} onDelete={remove} />
            ))}
          </div>
        )}
      </section>

      {/* ---------------- Inspiration ---------------- */}
      <section className="mt-14">
        <header className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.025em]">
              Find your aesthetic
            </h2>
            <p className="mt-1 text-[13px] text-chalk-3">
              Pick a direction and we&apos;ll recommend around it
            </p>
          </div>
          <Link
            href="/discover"
            className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-chalk-2 transition-colors hover:text-chalk"
          >
            Discover
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
          </Link>
        </header>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {AESTHETICS.slice(0, 5).map((a, i) => (
            <Link key={a.id} href={`/discover?theme=${a.id}`} className="group">
              <MoodTile
                aesthetic={a.id}
                seed={i}
                className="aspect-[3/4] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.02]"
              >
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <p className="text-[14px] font-semibold tracking-[-0.02em] text-white">
                    {a.label}
                  </p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-white/65">
                    {a.blurb}
                  </p>
                </div>
              </MoodTile>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------------- Products ---------------- */}
      <section className="mt-14 mb-4">
        <header className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.025em]">
              Light it up
            </h2>
            <p className="mt-1 text-[13px] text-chalk-3">
              Pieces that actually cast light in your 3D room
            </p>
          </div>
          <Link
            href="/shop?category=lighting"
            className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-chalk-2 transition-colors hover:text-chalk"
          >
            Shop all
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
          </Link>
        </header>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {featured.map((p) => (
            <Link key={p.id} href={`/shop?q=${encodeURIComponent(p.name)}`} className="group">
              <div
                className="relative aspect-square overflow-hidden rounded-[16px] border border-white/8 transition-all duration-400 group-hover:border-white/18"
                style={{
                  background: `radial-gradient(60% 60% at 50% 55%, ${p.emissive?.color}44 0%, transparent 70%), linear-gradient(160deg, #131317, #0c0c0f)`,
                }}
              >
                <div
                  className="absolute left-1/2 top-1/2 size-14 -translate-x-1/2 -translate-y-1/2 rounded-full blur-xl transition-all duration-500 group-hover:size-20"
                  style={{ background: p.emissive?.color, opacity: 0.55 }}
                />
              </div>
              <p className="mt-2 truncate text-[12.5px] font-medium text-chalk">{p.name}</p>
              <p className="text-[12px] text-chalk-3">{formatINR(p.price)}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
