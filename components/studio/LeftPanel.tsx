"use client";

import * as React from "react";
import { ChevronLeft, Grip, MousePointerSquareDashed, Plus, Search, Sofa, Sparkles, X } from "lucide-react";
import { FURNITURE, FURNITURE_GROUPS } from "@/lib/catalog/furniture";
import { PRODUCTS, PRODUCT_COUNT } from "@/lib/catalog/seed";
import { formatDims, formatINR } from "@/lib/catalog/source";
import { AESTHETICS, CATEGORIES, type CategoryId, type Product } from "@/lib/catalog/types";
import { planPlacements, recommend } from "@/lib/assistant/engine";
import { useStudio } from "@/lib/store/studio";
import { Chip, IconButton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";
import { ProductThumb } from "./ProductThumb";

/**
 * The decor library.
 *
 * Products are picked up with a pointer press rather than HTML5 drag-and-drop,
 * because a native drag can't report a cursor position inside the WebGL canvas
 * — the ghost has to follow the pointer through the 3D scene, which means
 * DragController needs raw pointermove events. A plain click still works and
 * places the item at the best spot the room has free, which is also the only
 * sane behaviour on touch.
 */
export function LeftPanel({ onTrace }: { onTrace?: () => void }) {
  const setOpen = useStudio((s) => s.setLeftPanel);
  const beginDraft = useStudio((s) => s.beginDraft);
  const room = useStudio((s) => s.room);
  const items = useStudio((s) => s.items);
  const addItemAt = useStudio((s) => s.addItemAt);
  const project = useStudio((s) => s.project);

  const [category, setCategory] = React.useState<CategoryId | "all" | "for-you">("all");
  const [query, setQuery] = React.useState("");

  const list = React.useMemo(() => {
    if (category === "for-you") {
      return recommend(
        {
          aesthetics: project?.aesthetic ? [project.aesthetic] : [],
          existing: items,
        },
        24,
      );
    }

    // Furniture is what is ALREADY in the room, so it lives in its own tab
    // rather than mixed into things to buy.
    const pool = category === "furniture" ? FURNITURE : PRODUCTS;

    const q = query.trim().toLowerCase();
    return pool.filter((p) => {
      if (category !== "all" && category !== "furniture" && p.category !== category) return false;
      if (!q) return true;
      const hay = [p.name, p.brand, p.subcategory, ...p.tags, ...p.aesthetics]
        .join(" ")
        .toLowerCase();
      return q.split(/\s+/).every((t) => hay.includes(t));
    });
  }, [category, query, items, project?.aesthetic]);

  /** Click-to-add: let the planner find a spot the room actually accepts. */
  const quickAdd = React.useCallback(
    (product: Product) => {
      if (!room) return;
      const [placement] = planPlacements([product], room, items);
      if (placement) addItemAt(product.id, placement.item);
    },
    [room, items, addItemAt],
  );

  return (
    <aside className="pointer-events-auto z-30 flex h-full w-full flex-col md:w-[312px] border-r border-white/8 bg-ink-1/90 backdrop-blur-xl">
      <header className="flex items-center justify-between gap-2 px-4 pb-3 pt-4">
        <h2 className="text-[14px] font-semibold tracking-[-0.02em]">Decor library</h2>
        <IconButton label="Collapse library" size="sm" onClick={() => setOpen(false)}>
          <ChevronLeft className="size-4" />
        </IconButton>
      </header>

      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-chalk-4" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (category === "for-you") setCategory("all");
            }}
            placeholder={`Search ${PRODUCT_COUNT} pieces`}
            className="h-9 w-full rounded-[11px] border border-white/9 bg-ink-2 pl-9 pr-8 text-[13px] text-chalk outline-none transition-colors placeholder:text-chalk-4 focus:border-accent/45"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-chalk-4 transition-colors hover:text-chalk-2"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-3">
        <Chip active={category === "for-you"} onClick={() => setCategory("for-you")}>
          <Sparkles className="size-3" />
          For you
        </Chip>
        <Chip active={category === "all"} onClick={() => setCategory("all")}>
          All
        </Chip>
        <Chip active={category === "furniture"} onClick={() => setCategory("furniture")}>
          <Sofa className="size-3" />
          Your room
        </Chip>
        {CATEGORIES.map((c) => (
          <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
            {c.label}
          </Chip>
        ))}
      </div>

      {category === "furniture" && (
        <div className="px-4 pb-3">
          <p className="text-[11.5px] leading-relaxed text-chalk-4">
            Put your real bed, desk and wardrobe in, so decor collides with them
            and can sit on top.
          </p>
          {onTrace && (
            <button
              onClick={onTrace}
              className="mt-2.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[10px] border border-accent/35 bg-accent/10 text-[12.5px] font-medium text-accent transition-colors hover:bg-accent/18"
            >
              <MousePointerSquareDashed className="size-3.5" />
              Trace one from your photo
            </button>
          )}
        </div>
      )}

      {category === "for-you" && (
        <p className="px-4 pb-2 text-[11.5px] leading-relaxed text-chalk-4">
          {project?.aesthetic
            ? `Matched to ${AESTHETICS.find((a) => a.id === project.aesthetic)?.label} and what's already in your room.`
            : "Based on what's already in your room. Pick a theme in Discover to sharpen this."}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {list.length === 0 ? (
          <p className="px-2 py-10 text-center text-[13px] text-chalk-4">
            Nothing matches “{query}”.
          </p>
        ) : (
          <ul className="space-y-1">
            {list.map((p) => (
              <li key={p.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => {
                    // Left button / touch only, and don't steal text selection
                    // from the search field.
                    if (e.button !== 0) return;
                    e.preventDefault();
                    beginDraft(p.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      quickAdd(p);
                    }
                  }}
                  className={cn(
                    "group flex w-full cursor-grab items-center gap-3 rounded-[13px] p-2 text-left",
                    "transition-colors duration-200 hover:bg-white/6 active:cursor-grabbing",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                  )}
                >
                  <ProductThumb product={p} className="size-14 shrink-0" />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium leading-tight text-chalk">
                      {p.name}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-chalk-4">{p.brand}</p>
                    <div className="mt-1 flex items-center gap-2">
                      {p.isFurniture ? (
                        <span className="text-[11.5px] font-medium text-chalk-3">
                          Already yours
                        </span>
                      ) : (
                        <span className="text-[12px] font-semibold text-chalk-2">
                          {formatINR(p.price)}
                        </span>
                      )}
                      <span className="truncate text-[10.5px] tabular-nums text-chalk-4">
                        {formatDims(p)}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <Grip className="size-3.5 text-chalk-4 opacity-0 transition-opacity group-hover:opacity-100" />
                    <button
                      aria-label={`Add ${p.name} to room`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        quickAdd(p);
                      }}
                      className="grid size-7 place-items-center rounded-[9px] bg-white/7 text-chalk-2 transition-all hover:bg-accent hover:text-black"
                    >
                      <Plus className="size-3.5" strokeWidth={2.4} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="border-t border-white/7 px-4 py-2.5">
        <p className="text-[11px] text-chalk-4">
          Drag onto your room, or press{" "}
          <span className="inline-grid size-4 place-items-center rounded bg-white/10 text-[9px] font-bold text-chalk-2">
            +
          </span>{" "}
          to place it for you
        </p>
      </footer>
    </aside>
  );
}
