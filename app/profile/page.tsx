"use client";

import * as React from "react";
import Link from "next/link";
import { Bookmark, Gauge, HardDrive, Palette, Sparkles } from "lucide-react";
import { productById, formatINR } from "@/lib/catalog/source";
import { AESTHETICS, aestheticById } from "@/lib/catalog/types";
import { usePreferences, useProjects } from "@/lib/hooks/useProjects";
import { PaletteDots } from "@/components/shell/MoodTile";
import { ProductThumb } from "@/components/studio/ProductThumb";
import { Chip, EmptyState, SectionLabel, Segmented, buttonClasses } from "@/components/ui/primitives";
import type { UserPreferences } from "@/lib/storage/types";

const QUALITY: { value: UserPreferences["quality"]; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "high", label: "High" },
  { value: "balanced", label: "Balanced" },
  { value: "performance", label: "Fast" },
];

export default function ProfilePage() {
  const { prefs, update, toggleSavedProduct } = usePreferences();
  const { projects } = useProjects();

  const savedProducts = prefs.savedProductIds
    .map((id) => productById(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const totalItems = projects?.reduce((s, p) => s + p.itemCount, 0) ?? 0;
  const savedValue = savedProducts.reduce((s, p) => s + p.price, 0);

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-10 md:py-12">
      <header className="mb-9 flex items-center gap-4">
        <div className="grid size-16 place-items-center rounded-[20px] bg-accent text-black">
          <Sparkles className="size-7" strokeWidth={2.1} />
        </div>
        <div>
          <h1 className="text-display text-[34px] md:text-[42px]">Your profile</h1>
          <p className="mt-1 text-[13px] text-chalk-3">
            Everything here lives on this device
          </p>
        </div>
      </header>

      {/* ---------------- Stats ---------------- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Spaces", String(projects?.length ?? 0)],
          ["Items placed", String(totalItems)],
          ["Saved pieces", String(savedProducts.length)],
          ["Saved value", savedValue ? formatINR(savedValue) : "—"],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-[var(--radius-card)] border border-white/8 bg-ink-1 px-4 py-4"
          >
            <p className="text-[11px] uppercase tracking-[0.09em] text-chalk-4">{label}</p>
            <p className="mt-1.5 text-[24px] font-semibold tracking-[-0.03em] tabular-nums">
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* ---------------- Aesthetics ---------------- */}
      <section className="mt-11">
        <SectionLabel className="mb-3">
          <span className="inline-flex items-center gap-1.5">
            <Palette className="size-3.5" />
            Your aesthetics
          </span>
        </SectionLabel>

        {prefs.savedAesthetics.length === 0 ? (
          <p className="text-[13px] text-chalk-3">
            None saved yet.{" "}
            <Link href="/discover" className="text-accent hover:underline">
              Browse the fifteen themes
            </Link>{" "}
            and save the ones that feel like you — they sharpen every
            recommendation in the studio.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {prefs.savedAesthetics.map((id) => {
              const a = aestheticById(id);
              return (
                <Link
                  key={id}
                  href={`/discover?theme=${id}`}
                  className="flex items-center gap-3 rounded-[var(--radius-card)] border border-white/8 bg-ink-1 p-3.5 transition-all hover:border-white/20"
                >
                  <span
                    className="size-11 shrink-0 rounded-[13px] ring-1 ring-inset ring-white/12"
                    style={{
                      background: `linear-gradient(140deg, ${a.swatch[0]}, ${a.swatch[1]} 55%, ${a.swatch[2]})`,
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium">{a.label}</p>
                    <p className="truncate text-[11.5px] text-chalk-4">{a.blurb}</p>
                  </div>
                  <PaletteDots aesthetic={id} />
                </Link>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-1.5">
          {AESTHETICS.filter((a) => !prefs.savedAesthetics.includes(a.id))
            .slice(0, 8)
            .map((a) => (
              <Chip
                key={a.id}
                onClick={() =>
                  void update({ savedAesthetics: [...prefs.savedAesthetics, a.id] })
                }
              >
                + {a.label}
              </Chip>
            ))}
        </div>
      </section>

      {/* ---------------- Saved products ---------------- */}
      <section className="mt-11">
        <SectionLabel className="mb-3">
          <span className="inline-flex items-center gap-1.5">
            <Bookmark className="size-3.5" />
            Saved pieces
          </span>
        </SectionLabel>

        {savedProducts.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-white/8 bg-ink-1/50">
            <EmptyState
              icon={<Bookmark className="size-5" />}
              title="Nothing saved"
              body="Bookmark pieces in Shop or Discover and they'll be waiting here — and weighted higher by the design assistant."
              action={
                <Link href="/shop" className={buttonClasses("secondary", "sm")}>
                  Browse the shop
                </Link>
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            {savedProducts.map((p) => (
              <div key={p.id} className="group">
                <ProductThumb product={p} className="aspect-square w-full" />
                <p className="mt-2 truncate text-[12.5px] font-medium">{p.name}</p>
                <p className="text-[12px] text-chalk-3">{formatINR(p.price)}</p>
                <button
                  onClick={() => void toggleSavedProduct(p.id)}
                  className="mt-1 text-[11px] text-chalk-4 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- Settings ---------------- */}
      <section className="mt-11 mb-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border border-white/8 bg-ink-1 p-5">
          <SectionLabel className="mb-3">
            <span className="inline-flex items-center gap-1.5">
              <Gauge className="size-3.5" />
              Render quality
            </span>
          </SectionLabel>
          <Segmented
            options={QUALITY}
            value={prefs.quality}
            onChange={(quality) => void update({ quality })}
            size="sm"
          />
          <p className="mt-3 text-[12px] leading-relaxed text-chalk-4">
            Auto lowers resolution on its own when frames start dropping. Set it
            manually if you&apos;d rather fix it either way.
          </p>
        </div>

        <div className="rounded-[var(--radius-card)] border border-white/8 bg-ink-1 p-5">
          <SectionLabel className="mb-3">
            <span className="inline-flex items-center gap-1.5">
              <HardDrive className="size-3.5" />
              Where your data lives
            </span>
          </SectionLabel>
          <p className="text-[12.5px] leading-relaxed text-chalk-3">
            Room photos, designs and saved items are stored in this browser&apos;s
            IndexedDB. Nothing is uploaded, and there is no account — which also
            means clearing site data deletes them, and they don&apos;t follow you
            to another device.
          </p>
        </div>
      </section>
    </div>
  );
}
