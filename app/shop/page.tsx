"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Bookmark, BookmarkCheck, ExternalLink, Search, Star, X } from "lucide-react";
import { PRODUCTS } from "@/lib/catalog/seed";
import { defaultCatalogSource, formatDims, formatINR, marketplaceUrl } from "@/lib/catalog/source";
import {
  AESTHETICS,
  CATEGORIES,
  type AestheticId,
  type CategoryId,
  type Product,
} from "@/lib/catalog/types";
import { usePreferences, useProjects } from "@/lib/hooks/useProjects";
import { ProductThumb } from "@/components/studio/ProductThumb";
import { Badge, Chip, EmptyState, buttonClasses } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";

export default function ShopPage() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh bg-ink-0" />}>
      <ShopContent />
    </React.Suspense>
  );
}

const SORTS = [
  { id: "featured", label: "Featured" },
  { id: "price-asc", label: "Price ↑" },
  { id: "price-desc", label: "Price ↓" },
  { id: "rating", label: "Top rated" },
] as const;

type SortId = (typeof SORTS)[number]["id"];

function ShopContent() {
  const params = useSearchParams();
  const { prefs, toggleSavedProduct } = usePreferences();
  const { projects } = useProjects();

  const [category, setCategory] = React.useState<CategoryId | "all">(
    (params.get("category") as CategoryId) ?? "all",
  );
  const [aesthetic, setAesthetic] = React.useState<AestheticId | null>(null);
  const [query, setQuery] = React.useState(params.get("q") ?? "");
  const [sort, setSort] = React.useState<SortId>("featured");
  const [detail, setDetail] = React.useState<Product | null>(null);

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = PRODUCTS.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (aesthetic && !p.aesthetics.includes(aesthetic)) return false;
      if (!q) return true;
      const hay = [p.name, p.brand, p.subcategory, ...p.tags, ...p.aesthetics]
        .join(" ")
        .toLowerCase();
      return q.split(/\s+/).every((t) => hay.includes(t));
    });

    switch (sort) {
      case "price-asc":
        return [...filtered].sort((a, b) => a.price - b.price);
      case "price-desc":
        return [...filtered].sort((a, b) => b.price - a.price);
      case "rating":
        return [...filtered].sort((a, b) => b.rating - a.rating || b.reviews - a.reviews);
      default:
        return filtered;
    }
  }, [category, aesthetic, query, sort]);

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-10 md:py-12">
      <header className="mb-7">
        <h1 className="text-display text-[38px] md:text-[46px]">Shop</h1>
        <p className="mt-2 max-w-[56ch] text-[13.5px] leading-relaxed text-chalk-3">
          Small, aesthetic pieces built for dorms, desks and rented corners —
          every one with real dimensions, so it drops into your 3D room at true
          size.
        </p>
      </header>

      {/* ---------------- Filters ---------------- */}
      <div className="sticky top-0 z-20 -mx-5 mb-6 space-y-3 bg-ink-0/60 px-5 py-3 backdrop-blur-xl md:-mx-10 md:px-10">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-chalk-4" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search neon, posters, plants…"
              className="h-10 w-full rounded-[12px] border border-white/9 bg-ink-1 pl-9 pr-8 text-[13.5px] outline-none transition-colors placeholder:text-chalk-4 focus:border-accent/45"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-chalk-4 hover:text-chalk-2"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="flex gap-1.5">
            {SORTS.map((s) => (
              <Chip key={s.id} active={sort === s.id} onClick={() => setSort(s.id)}>
                {s.label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          <Chip active={category === "all"} onClick={() => setCategory("all")}>
            All
          </Chip>
          {CATEGORIES.map((c) => (
            <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
              {c.label}
            </Chip>
          ))}
          <span className="mx-1 h-8 w-px shrink-0 bg-white/10" />
          {AESTHETICS.map((a) => (
            <Chip
              key={a.id}
              active={aesthetic === a.id}
              onClick={() => setAesthetic(aesthetic === a.id ? null : a.id)}
            >
              {a.label}
            </Chip>
          ))}
        </div>
      </div>

      <p className="mb-4 text-[12.5px] text-chalk-4">
        {results.length} {results.length === 1 ? "piece" : "pieces"}
      </p>

      {results.length === 0 ? (
        <EmptyState
          icon={<Search className="size-5" />}
          title="Nothing matched"
          body="Try a broader category, or clear the aesthetic filter."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {results.map((p) => {
            const liked = prefs.savedProductIds.includes(p.id);
            return (
              <article
                key={p.id}
                className="group flex flex-col rounded-[var(--radius-card)] border border-white/8 bg-ink-1 p-3 transition-all duration-300 hover:border-white/18"
              >
                <button
                  onClick={() => setDetail(p)}
                  className="text-left"
                  aria-label={`View ${p.name}`}
                >
                  <ProductThumb product={p} className="aspect-square w-full" />
                </button>

                <div className="mt-2.5 flex-1">
                  <p className="truncate text-[13px] font-medium leading-tight">{p.name}</p>
                  <p className="mt-0.5 text-[11.5px] text-chalk-4">{p.brand}</p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-chalk-4">
                    <Star className="size-3 fill-current text-warm" />
                    {p.rating} · {p.reviews.toLocaleString("en-IN")}
                  </p>
                </div>

                <div className="mt-2.5 flex items-end justify-between gap-2">
                  <div>
                    <p className="text-[14px] font-semibold">{formatINR(p.price)}</p>
                    {p.mrp && (
                      <p className="text-[11px] text-chalk-4 line-through">
                        {formatINR(p.mrp)}
                      </p>
                    )}
                    <p className="mt-0.5 text-[10.5px] tabular-nums text-chalk-4">
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
                    {liked ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {detail && (
        <ProductSheet
          product={detail}
          onClose={() => setDetail(null)}
          projectId={projects?.[0]?.id}
        />
      )}
    </div>
  );
}

function ProductSheet({
  product,
  onClose,
  projectId,
}: {
  product: Product;
  onClose: () => void;
  projectId?: string;
}) {
  const [related, setRelated] = React.useState<Product[]>([]);

  React.useEffect(() => {
    void defaultCatalogSource.related(product.id, 4).then(setRelated);
  }, [product.id]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={product.name}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88dvh] w-full max-w-[520px] overflow-y-auto rounded-t-[24px] border border-white/10 bg-ink-1 p-5 edge-light sm:rounded-[24px]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <Badge>{product.subcategory}</Badge>
            <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.03em]">
              {product.name}
            </h2>
            <p className="mt-0.5 text-[13px] text-chalk-3">{product.brand}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-[10px] text-chalk-3 hover:bg-white/8 hover:text-chalk"
          >
            <X className="size-4" />
          </button>
        </div>

        <ProductThumb product={product} className="mt-4 aspect-[16/10] w-full" />

        <div className="mt-4 flex items-end justify-between">
          <div>
            <p className="text-[24px] font-semibold tracking-[-0.03em]">
              {formatINR(product.price)}
            </p>
            {product.mrp && (
              <p className="text-[12.5px] text-chalk-4">
                <span className="line-through">{formatINR(product.mrp)}</span>{" "}
                <span className="text-accent">
                  {Math.round((1 - product.price / product.mrp) * 100)}% off
                </span>
              </p>
            )}
          </div>
          <p className="flex items-center gap-1 text-[12.5px] text-chalk-3">
            <Star className="size-3.5 fill-current text-warm" />
            {product.rating} · {product.reviews.toLocaleString("en-IN")} reviews
          </p>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-[14px] border border-white/8 p-4">
          {[
            ["Real size", formatDims(product)],
            ["Mounts on", MOUNT_LABEL[product.mount]],
            ["Category", CATEGORIES.find((c) => c.id === product.category)?.label ?? "—"],
            ["Casts light", product.emissive ? "Yes, in 3D" : "No"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] uppercase tracking-[0.08em] text-chalk-4">{k}</dt>
              <dd className="mt-0.5 text-[13px] font-medium">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {product.aesthetics.map((a) => (
            <Link key={a} href={`/discover?theme=${a}`}>
              <Chip>{AESTHETICS.find((x) => x.id === a)?.label}</Chip>
            </Link>
          ))}
        </div>

        <div className="mt-5 flex gap-2.5">
          <Link
            href={projectId ? `/studio/${projectId}` : "/onboarding"}
            className={buttonClasses("primary", "md", "flex-1")}
          >
            {projectId ? "Open studio to place it" : "Upload a room to try it"}
          </Link>
          <a
            href={marketplaceUrl(product)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses("outline", "md", "gap-1.5")}
          >
            Amazon.in
            <ExternalLink className="size-3.5" />
          </a>
        </div>

        {related.length > 0 && (
          <section className="mt-6">
            <h3 className="text-[11px] uppercase tracking-[0.11em] text-chalk-3 font-semibold">
              Goes with it
            </h3>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {related.map((r) => (
                <button key={r.id} className="text-left" onClick={() => void 0}>
                  <ProductThumb product={r} className="aspect-square w-full" />
                  <p className="mt-1.5 truncate text-[11px] text-chalk-2">{r.name}</p>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

const MOUNT_LABEL: Record<Product["mount"], string> = {
  wall: "Walls",
  floor: "The floor",
  tabletop: "Any flat surface",
  ceiling: "The ceiling",
  edge: "Along edges",
};
