"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Bookmark, BookmarkCheck, Plus } from "lucide-react";
import { recommend } from "@/lib/assistant/scoring";
import { formatDims, formatINR } from "@/lib/catalog/source";
import { AESTHETICS, aestheticById, type AestheticId } from "@/lib/catalog/types";
import { useProjects, usePreferences } from "@/lib/hooks/useProjects";
import { MoodTile, PaletteDots } from "@/components/shell/MoodTile";
import { AestheticCarousel } from "@/components/shell/AestheticCarousel";
import { aestheticPhoto } from "@/lib/catalog/aestheticPhotos";
import { ProductThumb } from "@/components/studio/ProductThumb";
import { Button, Chip, buttonClasses } from "@/components/ui/primitives";
import { storage } from "@/lib/storage/idb";
import { cn } from "@/lib/utils/cn";

function isAesthetic(v: string | null): v is AestheticId {
  return Boolean(v && AESTHETICS.some((a) => a.id === v));
}

export default function DiscoverPage() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh bg-ink-0" />}>
      <DiscoverContent />
    </React.Suspense>
  );
}

function DiscoverContent() {
  const params = useSearchParams();
  const router = useRouter();
  const theme = params.get("theme");
  const active = isAesthetic(theme) ? theme : null;

  const { prefs, update, toggleSavedProduct } = usePreferences();
  const { projects } = useProjects();

  const saved = prefs.savedAesthetics;

  const toggleTheme = React.useCallback(
    (id: AestheticId) => {
      void update({
        savedAesthetics: saved.includes(id)
          ? saved.filter((a) => a !== id)
          : [...saved, id],
      });
    },
    [saved, update],
  );

  /** Apply a theme to a project so the studio's "For you" tab sharpens. */
  const applyToProject = React.useCallback(
    async (id: AestheticId, projectId: string) => {
      const project = await storage.getProject(projectId);
      if (!project) return;
      await storage.saveProject({ ...project, aesthetic: id, updatedAt: Date.now() });
      router.push(`/studio/${projectId}`);
    },
    [router],
  );

  /* ---------------- Theme detail ---------------- */
  if (active) {
    const a = aestheticById(active);
    const picks = recommend({ aesthetics: [active] }, 12);
    const isSaved = saved.includes(active);

    return (
      <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-10 md:py-12">
        <Link
          href="/discover"
          className="mb-6 inline-flex items-center gap-2 text-[13px] font-medium text-chalk-2 transition-colors hover:text-chalk"
        >
          <ArrowLeft className="size-4" />
          All aesthetics
        </Link>

        <section className="relative overflow-hidden rounded-[26px] border border-white/8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={aestheticPhoto(active, 1600, 700)}
            alt={`A ${a.label.toLowerCase()} room`}
            className="absolute inset-0 size-full object-cover"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(28,24,20,0.92)_0%,rgba(28,24,20,0.6)_50%,rgba(28,24,20,0.15)_100%)]" />
          <div className="relative px-6 py-12 md:px-12 md:py-16">
            <h1 className="text-display text-[42px] leading-[0.95] md:text-[64px] text-white">
              {a.label}
            </h1>
            <p className="mt-3 max-w-[44ch] text-[15px] leading-relaxed text-white/70">
              {a.blurb}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button
                variant={isSaved ? "secondary" : "primary"}
                onClick={() => toggleTheme(active)}
              >
                {isSaved ? (
                  <>
                    <BookmarkCheck className="size-4" />
                    Saved
                  </>
                ) : (
                  <>
                    <Bookmark className="size-4" />
                    Save this aesthetic
                  </>
                )}
              </Button>

              <div className="flex items-center gap-2.5 rounded-full glass-strong px-3.5 py-2">
                <PaletteDots aesthetic={active} />
                <span className="text-[11.5px] font-medium text-chalk-2">Palette</span>
              </div>
            </div>
          </div>
        </section>

        {/* Apply to a room */}
        {projects && projects.length > 0 && (
          <section className="mt-10">
            <h2 className="text-[17px] font-semibold tracking-[-0.025em]">
              Apply it to a room
            </h2>
            <p className="mt-1 text-[13px] text-chalk-3">
              Sets the theme so recommendations and the assistant aim at {a.label}.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => void applyToProject(active, p.id)}
                  className="inline-flex items-center gap-2 rounded-[12px] border border-white/10 bg-ink-1 px-3.5 py-2.5 text-[13px] font-medium transition-all hover:border-accent/40 hover:bg-ink-2"
                >
                  {p.name}
                  <span className="text-[11px] text-chalk-4">{p.itemCount} items</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Mood board */}
        <section className="mt-12">
          <h2 className="text-[17px] font-semibold tracking-[-0.025em]">Mood board</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <MoodTile
                key={i}
                aesthetic={active}
                seed={i * 7 + 2}
                className={cn(
                  "transition-transform duration-500 hover:scale-[1.02]",
                  i === 0 || i === 3 ? "aspect-[3/4]" : "aspect-square",
                )}
              />
            ))}
          </div>
        </section>

        {/* Recommended products */}
        <section className="mt-12 mb-4">
          <h2 className="text-[17px] font-semibold tracking-[-0.025em]">
            Decor that fits
          </h2>
          <p className="mt-1 text-[13px] text-chalk-3">
            Scored against the {a.label} palette and tags
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {picks.map((p) => {
              const liked = prefs.savedProductIds.includes(p.id);
              return (
                <div
                  key={p.id}
                  className="group rounded-[var(--radius-card)] border border-white/8 bg-ink-1 p-3 transition-all duration-300 hover:border-white/18"
                >
                  <ProductThumb product={p} className="aspect-square w-full" />
                  <p className="mt-2.5 truncate text-[13px] font-medium">{p.name}</p>
                  <p className="text-[11.5px] text-chalk-4">{p.brand}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[13px] font-semibold">{formatINR(p.price)}</p>
                      <p className="text-[10.5px] tabular-nums text-chalk-4">
                        {formatDims(p)}
                      </p>
                    </div>
                    <button
                      aria-label={liked ? `Unsave ${p.name}` : `Save ${p.name}`}
                      onClick={() => void toggleSavedProduct(p.id)}
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-[10px] transition-all",
                        liked
                          ? "bg-accent text-black"
                          : "bg-white/6 text-chalk-3 hover:bg-white/12 hover:text-chalk",
                      )}
                    >
                      {liked ? (
                        <BookmarkCheck className="size-4" />
                      ) : (
                        <Bookmark className="size-4" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  /* ---------------- Theme index ---------------- */
  return (
    <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-10 md:py-12">
      <header className="mb-8">
        <h1 className="text-display text-[38px] md:text-[46px]">Discover</h1>
        <p className="mt-2 max-w-[54ch] text-[13.5px] leading-relaxed text-chalk-3">
          Fifteen directions, each with its own palette and a decor shortlist.
          Pick one and it steers what the studio recommends.
        </p>
      </header>

      {saved.length > 0 && (
        <section className="mb-9">
          <h2 className="mb-3 text-[11px] uppercase tracking-[0.11em] text-chalk-3 font-semibold">
            Saved
          </h2>
          <div className="flex flex-wrap gap-2">
            {saved.map((id) => (
              <Link key={id} href={`/discover?theme=${id}`}>
                <Chip active>{aestheticById(id).label}</Chip>
              </Link>
            ))}
          </div>
        </section>
      )}

      <AestheticCarousel saved={saved} showJumpList />

      <div className="mt-12 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-ink-2 px-5 py-4">
        <p className="flex-1 text-[13px] text-chalk-2">
          Got a room in mind? Upload it and try these themes against your real walls.
        </p>
        <Link href="/onboarding" className={buttonClasses("primary", "sm", "gap-1.5")}>
          <Plus className="size-3.5" strokeWidth={2.4} />
          Upload a room
        </Link>
      </div>
    </div>
  );
}
