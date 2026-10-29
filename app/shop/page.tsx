"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Box,
  Check,
  ChevronDown,
  ExternalLink,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from "lucide-react";
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
import { GlareCard } from "@/components/ui/glare-cards";
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
  { id: "recommended", label: "Recommended" },
  { id: "rating", label: "Top rated" },
  { id: "price-asc", label: "Price: low to high" },
  { id: "price-desc", label: "Price: high to low" },
] as const;

type SortId = (typeof SORTS)[number]["id"];

/**
 * "Featured" is a filter: the most versatile pieces, suiting four or more styles.
 * (Ratings in the seed catalogue are placeholders, so they can't define it.)
 */
function isFeatured(p: Product): boolean {
  return p.aesthetics.length >= 4;
}

function ShopContent() {
  const params = useSearchParams();
  const { prefs, toggleSavedProduct } = usePreferences();
  const { projects } = useProjects();

  const [category, setCategory] = React.useState<CategoryId | "all">(
    (params.get("category") as CategoryId) ?? "all",
  );
  const [aesthetic, setAesthetic] = React.useState<AestheticId | null>(null);
  const [query, setQuery] = React.useState(params.get("q") ?? "");
  const [sort, setSort] = React.useState<SortId>("recommended");
  const [featuredOnly, setFeaturedOnly] = React.useState(false);
  const [panel, setPanel] = React.useState<null | "filter" | "sort">(null);
  const [detail, setDetail] = React.useState<Product | null>(null);
  const activeFilters = (category !== "all" ? 1 : 0) + (aesthetic ? 1 : 0) + (featuredOnly ? 1 : 0);

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = PRODUCTS.filter((p) => {
      if (featuredOnly && !isFeatured(p)) return false;
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
  }, [category, aesthetic, query, sort, featuredOnly]);

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

      {/* ---------------- Search, filter, sort ---------------- */}
      <div className="sticky top-[66px] z-20 -mx-5 mb-5 space-y-3 bg-ink-0/85 px-5 py-3 backdrop-blur-xl md:top-[76px] md:-mx-10 md:px-10">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-chalk-4" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search neon, posters, plants…"
            aria-label="Search the shop"
            className="h-11 w-full rounded-[12px] border border-line bg-ink-1 pl-9 pr-8 text-[14px] outline-none transition-colors placeholder:text-chalk-4 focus:border-accent/45"
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

        <div className="flex items-center gap-2">
          <button
            onClick={() => setPanel("filter")}
            aria-haspopup="dialog"
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-[11px] border px-3.5 text-[13.5px] font-semibold transition-colors",
              activeFilters
                ? "border-accent/60 bg-accent/10 text-chalk"
                : "border-line text-chalk-2 hover:border-line-strong hover:text-chalk",
            )}
          >
            <SlidersHorizontal className="size-4" />
            Filter
            {activeFilters > 0 && (
              <span className="grid size-5 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-ink">
                {activeFilters}
              </span>
            )}
          </button>

          <div className="relative">
            <button
              onClick={() => setPanel(panel === "sort" ? null : "sort")}
              aria-haspopup="menu"
              aria-expanded={panel === "sort"}
              className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-[11px] border border-line px-3.5 text-[13.5px] font-semibold text-chalk-2 transition-colors hover:border-line-strong hover:text-chalk"
            >
              <span className="hidden text-chalk-4 sm:inline">Sort:</span>
              <span className="text-chalk">{SORTS.find((x) => x.id === sort)?.label}</span>
              <ChevronDown className="size-4" />
            </button>
            {panel === "sort" && (
              <>
                <button
                  aria-label="Close sort"
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => setPanel(null)}
                />
                <ul
                  role="menu"
                  className="absolute left-0 top-12 z-40 w-[230px] overflow-hidden rounded-[14px] border border-line bg-ink-2 p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.45)]"
                >
                  {SORTS.map((o) => (
                    <li key={o.id}>
                      <button
                        role="menuitemradio"
                        aria-checked={sort === o.id}
                        onClick={() => {
                          setSort(o.id);
                          setPanel(null);
                        }}
                        className="flex w-full items-center justify-between rounded-[10px] px-3 py-2.5 text-left text-[13.5px] text-chalk-2 transition-colors hover:bg-white/6 hover:text-chalk"
                      >
                        {o.label}
                        {sort === o.id && <Check className="size-4 text-accent" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <p className="ml-auto whitespace-nowrap text-[12.5px] text-chalk-4">
            {results.length} {results.length === 1 ? "piece" : "pieces"}
          </p>
        </div>

        {activeFilters > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {featuredOnly && <ActiveChip label="Featured" onClear={() => setFeaturedOnly(false)} />}
            {category !== "all" && (
              <ActiveChip
                label={CATEGORIES.find((c) => c.id === category)?.label ?? ""}
                onClear={() => setCategory("all")}
              />
            )}
            {aesthetic && (
              <ActiveChip
                label={AESTHETICS.find((x) => x.id === aesthetic)?.label ?? ""}
                onClear={() => setAesthetic(null)}
              />
            )}
          </div>
        )}
      </div>

      {panel === "filter" && (
        <FilterPanel
          count={results.length}
          featuredOnly={featuredOnly}
          onFeatured={setFeaturedOnly}
          category={category}
          onCategory={setCategory}
          aesthetic={aesthetic}
          onAesthetic={setAesthetic}
          onClear={() => {
            setFeaturedOnly(false);
            setCategory("all");
            setAesthetic(null);
          }}
          onClose={() => setPanel(null)}
        />
      )}

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
              <GlareCard key={p.id} className="flex min-w-0 flex-col">
              {/* The whole card opens the product; the image button keeps it reachable by keyboard */}
              <article
                onClick={() => setDetail(p)}
                className="flex h-full min-w-0 cursor-pointer flex-col p-2.5 md:p-3"
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDetail(p);
                  }}
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
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold">{formatINR(p.price)}</p>
                    {p.mrp && (
                      <p className="text-[11px] text-chalk-4 line-through">
                        {formatINR(p.mrp)}
                      </p>
                    )}
                    <p className="mt-0.5 truncate text-[10.5px] tabular-nums text-chalk-4">
                      {formatDims(p)}
                    </p>
                  </div>
                  <button
                    aria-label={liked ? `Unsave ${p.name}` : `Save ${p.name}`}
                    onClick={(e) => {
                      // Saving shouldn't also open the product.
                      e.stopPropagation();
                      void toggleSavedProduct(p.id);
                    }}
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
              </GlareCard>
            );
          })}
        </div>
      )}

      {detail && (
        <ProductSheet
          product={detail}
          onClose={() => setDetail(null)}
          onOpen={setDetail}
          projectId={projects?.[0]?.id}
        />
      )}
    </div>
  );
}

function ProductSheet({
  product,
  onClose,
  onOpen,
  projectId,
}: {
  product: Product;
  onClose: () => void;
  onOpen: (p: Product) => void;
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

        <div className="mt-5 grid grid-cols-[1fr_auto] gap-2.5">
          <Link
            href={projectId ? `/studio/${projectId}` : "/onboarding"}
            className="group inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-accent px-5 text-[14px] font-semibold text-accent-ink shadow-[0_8px_24px_-6px_rgba(241,230,210,0.35)] transition-all hover:-translate-y-px hover:bg-accent-hover"
          >
            <Box className="size-4" strokeWidth={2.2} />
            {projectId ? "Try in my room" : "Try in your room"}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href={marketplaceUrl(product)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-warm/50 bg-warm/10 px-4 text-[13.5px] font-semibold text-chalk transition-all hover:-translate-y-px hover:border-warm hover:bg-warm/20"
          >
            Buy on Amazon
            <ExternalLink className="size-3.5" />
          </a>
        </div>

        {/* Suggestions sit in their own panel so they never read as part of this product */}
        {related.length > 0 && (
          <section className="mt-7 rounded-[18px] border border-line bg-ink-2/80 p-4">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="text-[15px] font-bold tracking-[-0.01em] text-chalk">Goes well with it</h3>
              <p className="text-[11.5px] text-chalk-3">Suggestions</p>
            </div>
            <div className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
              {related.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onOpen(r)}
                  className="w-[124px] shrink-0 rounded-[14px] border border-line bg-ink-1 p-2 text-left transition-colors hover:border-line-strong"
                >
                  <ProductThumb product={r} className="aspect-square w-full" />
                  <p className="mt-2 truncate text-[12px] font-semibold text-chalk">{r.name}</p>
                  <p className="text-[11.5px] text-chalk-3">{formatINR(r.price)}</p>
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

function ActiveChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      onClick={onClear}
      aria-label={`Remove filter ${label}`}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 pl-3 pr-2 text-[12.5px] font-medium text-chalk transition-colors hover:border-accent"
    >
      {label}
      <X className="size-3.5 text-chalk-3" />
    </button>
  );
}

function FilterPanel({
  count,
  featuredOnly,
  onFeatured,
  category,
  onCategory,
  aesthetic,
  onAesthetic,
  onClear,
  onClose,
}: {
  count: number;
  featuredOnly: boolean;
  onFeatured: (v: boolean) => void;
  category: CategoryId | "all";
  onCategory: (c: CategoryId | "all") => void;
  aesthetic: AestheticId | null;
  onAesthetic: (a: AestheticId | null) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Filter"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-[520px] flex-col rounded-t-[22px] border border-line bg-ink-1 sm:rounded-[22px]"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[17px] font-bold">Filter</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-[10px] text-chalk-3 hover:bg-white/8 hover:text-chalk"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5">
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[14px] border border-line bg-ink-2 px-4 py-3">
            <span>
              <span className="block text-[14px] font-semibold">Featured</span>
              <span className="block text-[12px] text-chalk-3">The most versatile pieces: they suit 4 or more styles</span>
            </span>
            <input
              type="checkbox"
              checked={featuredOnly}
              onChange={(e) => onFeatured(e.target.checked)}
              className="size-5 accent-[var(--color-accent)]"
            />
          </label>

          <fieldset>
            <legend className="mb-2.5 text-[13px] font-semibold text-chalk-2">Category</legend>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={category === "all"} onClick={() => onCategory("all")}>
                All
              </Chip>
              {CATEGORIES.map((c) => (
                <Chip key={c.id} active={category === c.id} onClick={() => onCategory(c.id)}>
                  {c.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2.5 text-[13px] font-semibold text-chalk-2">Aesthetic</legend>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={aesthetic === null} onClick={() => onAesthetic(null)}>
                Any
              </Chip>
              {AESTHETICS.map((x) => (
                <Chip
                  key={x.id}
                  active={aesthetic === x.id}
                  onClick={() => onAesthetic(aesthetic === x.id ? null : x.id)}
                >
                  {x.label}
                </Chip>
              ))}
            </div>
          </fieldset>
        </div>

        <footer className="flex gap-2.5 border-t border-line px-5 py-4">
          <button onClick={onClear} className={buttonClasses("outline", "md", "flex-1")}>
            Clear all
          </button>
          <button onClick={onClose} className={buttonClasses("primary", "md", "flex-[2]")}>
            Show {count} {count === 1 ? "piece" : "pieces"}
          </button>
        </footer>
      </div>
    </div>
  );
}
