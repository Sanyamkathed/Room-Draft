"use client";

import * as React from "react";
import {
  ChevronLeft,
  Grip,
  MousePointerSquareDashed,
  Pencil,
  Plus,
  Search,
  Sofa,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { useCustomProducts } from "@/lib/catalog/custom";
import { FURNITURE, FURNITURE_GROUPS } from "@/lib/catalog/furniture";
import { PRODUCTS, PRODUCT_COUNT } from "@/lib/catalog/seed";
import { formatDims, formatINR } from "@/lib/catalog/source";
import { AESTHETICS, CATEGORIES, type CategoryId, type Product } from "@/lib/catalog/types";
import { planPlacements, recommend } from "@/lib/assistant/engine";
import { placeOnSurface } from "@/lib/placement/resolve";
import { productById } from "@/lib/catalog/source";
import { useStudio } from "@/lib/store/studio";
import { Chip, IconButton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";
import { CustomItemDialog } from "./CustomItemDialog";
import { HoverPreview } from "./HoverPreview";
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
  const setSheetSize = useStudio((s) => s.setSheetSize);
  const beginDraft = useStudio((s) => s.beginDraft);
  const room = useStudio((s) => s.room);
  const items = useStudio((s) => s.items);
  const addItemAt = useStudio((s) => s.addItemAt);
  const project = useStudio((s) => s.project);
  const selectedId = useStudio((s) => s.selectedId);
  const gridSnap = useStudio((s) => s.gridSnap);

  // When a shelf, desk or table is selected, "+" puts things ON it — the
  // fastest way there is to not have to aim at all, on a phone especially.
  const target = React.useMemo(() => {
    const it = selectedId ? items.find((i) => i.id === selectedId) : undefined;
    const p = it ? productById(it.productId) : undefined;
    return it && p?.stackable && p.model !== "rug" && p.model !== "checkerRug" ? { item: it, product: p } : null;
  }, [selectedId, items]);

  const draft = useStudio((s) => s.draft);
  const [hover, setHover] = React.useState<{ product: Product; y: number; x: number } | null>(null);
  const hoverTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHover = React.useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHover(null);
  }, []);
  // A short delay, so sweeping the mouse down the list doesn't flash a
  // preview for every card it passes over.
  const startHover = React.useCallback((product: Product, el: HTMLElement, pointerType: string) => {
    if (pointerType !== "mouse") return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      const card = el.getBoundingClientRect();
      const panel = el.closest("aside")?.getBoundingClientRect();
      setHover({ product, y: card.top + card.height / 2, x: panel?.right ?? card.right });
    }, 140);
  }, []);
  React.useEffect(() => () => clearHover(), [clearHover]);

  const mine = useCustomProducts();
  const [builder, setBuilder] = React.useState<Product | "new" | null>(null);

  const [category, setCategory] = React.useState<CategoryId | "all" | "for-you" | "mine">("all");
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
    // The user's own items lead "All" and appear in their category's tab too.
    const pool =
      category === "furniture" ? FURNITURE : category === "mine" ? mine : [...mine, ...PRODUCTS];

    const q = query.trim().toLowerCase();
    return pool.filter((p) => {
      if (category !== "all" && category !== "furniture" && category !== "mine" && p.category !== category) return false;
      if (!q) return true;
      const hay = [p.name, p.brand, p.subcategory, ...p.tags, ...p.aesthetics]
        .join(" ")
        .toLowerCase();
      return q.split(/\s+/).every((t) => hay.includes(t));
    });
  }, [category, query, items, project?.aesthetic, mine]);

  /** Click-to-add: let the planner find a spot the room actually accepts. */
  const quickAdd = React.useCallback(
    (product: Product) => {
      if (!room) return;
      if (target && product.mount === "tabletop") {
        const onIt = placeOnSurface(product, target.item.id, { room, items, gridSnap });
        if (onIt) {
          addItemAt(product.id, onIt.item);
          return;
        }
      }
      const [placement] = planPlacements([product], room, items);
      if (placement) addItemAt(product.id, placement.item);
    },
    [room, items, addItemAt, target, gridSnap],
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
        <Chip active={category === "mine"} onClick={() => setCategory("mine")}>
          <Wand2 className="size-3" />
          My items{mine.length ? ` · ${mine.length}` : ""}
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

      {(category === "mine" || category === "all") && (
        <div className="px-4 pb-3">
          {category === "mine" && (
            <p className="mb-2.5 text-[11.5px] leading-relaxed text-chalk-4">
              Anything from Pinterest, a shop listing or your own photo — at its
              real size, saved on this device.
            </p>
          )}
          <button
            onClick={() => setBuilder("new")}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[10px] border border-accent/35 bg-accent/10 text-[12.5px] font-medium text-accent transition-colors hover:bg-accent/18"
          >
            <Wand2 className="size-3.5" />
            Make your own item
          </button>
        </div>
      )}

      {category === "for-you" && (
        <p className="px-4 pb-2 text-[11.5px] leading-relaxed text-chalk-4">
          {project?.aesthetic
            ? `Matched to ${AESTHETICS.find((a) => a.id === project.aesthetic)?.label} and what's already in your room.`
            : "Based on what's already in your room. Pick a theme in Discover to sharpen this."}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4" onScroll={clearHover}>
        {list.length === 0 ? (
          <p className="px-2 py-10 text-center text-[13px] text-chalk-4">
            {category === "mine" && !query
              ? "Nothing here yet — make your first item above."
              : `Nothing matches “${query}”.`}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 md:grid-cols-1 md:gap-1">
            {list.map((p) => (
              <li key={p.id}>
                <LibraryCard
                  product={p}
                  onMouseDrag={() => {
                    clearHover();
                    beginDraft(p.id);
                  }}
                  onTouchDrag={() => beginDraft(p.id)}
                  onPlace={() => {
                    quickAdd(p);
                    if (window.matchMedia("(max-width: 767px)").matches) setSheetSize("peek");
                  }}
                  onEdit={
                    p.custom
                      ? () => {
                          clearHover();
                          setBuilder(p);
                        }
                      : undefined
                  }
                  onHoverStart={(el, type) => startHover(p, el, type)}
                  onHoverEnd={clearHover}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="border-t border-white/7 px-4 py-2.5">
        {target ? (
          <p className="text-[11px] text-chalk-3">
            <span className="font-semibold text-accent">+</span> adds onto{" "}
            <span className="font-medium text-chalk">{target.product.name}</span>
          </p>
        ) : (
          <>
            <p className="text-[11px] text-chalk-4 md:hidden">
              Tap to place it · hold to drag it into the room
            </p>
            <p className="hidden text-[11px] text-chalk-4 md:block">
              Drag onto your room, or press{" "}
              <span className="inline-grid size-4 place-items-center rounded bg-white/10 text-[9px] font-bold text-chalk-2">
                +
              </span>{" "}
              to place it for you
            </p>
          </>
        )}
      </footer>

      {builder ? (
        <CustomItemDialog
          initial={builder === "new" ? undefined : builder}
          onClose={() => setBuilder(null)}
          onSaved={(product, place) => {
            setBuilder(null);
            setCategory("mine");
            if (place) quickAdd(product);
          }}
        />
      ) : null}

      <HoverPreview
        product={hover && !draft && !builder ? hover.product : null}
        anchor={hover && !draft ? { y: hover.y, x: hover.x } : null}
      />
    </aside>
  );
}

/**
 * One item in the library.
 *
 * A mouse press picks it up straight away, so it can be dragged into the
 * room. A finger can't do that: the same touch has to scroll the list. So on
 * touch a quick tap PLACES the item (the planner finds it a spot and the sheet
 * drops to show the room), a long-press picks it up to drag, and any movement
 * before then is left to the browser as a scroll.
 */
function LibraryCard({
  product: p,
  onMouseDrag,
  onTouchDrag,
  onPlace,
  onEdit,
  onHoverStart,
  onHoverEnd,
}: {
  product: Product;
  onMouseDrag: () => void;
  onTouchDrag: () => void;
  onPlace: () => void;
  onEdit?: () => void;
  onHoverStart: (el: HTMLElement, pointerType: string) => void;
  onHoverEnd: () => void;
}) {
  const press = React.useRef<{
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
    fired: boolean;
  } | null>(null);
  const cleanup = React.useRef<(() => void) | null>(null);
  const [lifted, setLifted] = React.useState(false);

  React.useEffect(() => () => cleanup.current?.(), []);

  const startTouch = (e: React.PointerEvent) => {
    const block = (ev: TouchEvent) => ev.preventDefault();
    const end = () => {
      const pr = press.current;
      press.current = null;
      cleanup.current = null;
      setLifted(false);
      window.removeEventListener("touchmove", block);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      if (pr) clearTimeout(pr.timer);
      return pr;
    };
    const cancel = () => {
      end();
    };
    const move = (ev: PointerEvent) => {
      const pr = press.current;
      if (!pr || pr.fired) return;
      // Moved before the hold completed: it's a scroll, so let the browser have it.
      if (Math.hypot(ev.clientX - pr.x, ev.clientY - pr.y) > 10) end();
    };
    const up = () => {
      const pr = end();
      if (pr && !pr.fired) onPlace();
    };

    press.current = {
      x: e.clientX,
      y: e.clientY,
      fired: false,
      timer: setTimeout(() => {
        const pr = press.current;
        if (!pr) return;
        pr.fired = true;
        setLifted(true);
        navigator.vibrate?.(12);
        // From here the finger is dragging the item, so the list must not
        // scroll underneath it (that would also cancel the pointer).
        window.addEventListener("touchmove", block, { passive: false });
        onTouchDrag();
      }, 380),
    };
    cleanup.current = end;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  const free = p.isFurniture || (p.custom && !p.price);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${p.name}: tap to place, hold to drag`}
      onPointerEnter={(e) => onHoverStart(e.currentTarget, e.pointerType)}
      onPointerLeave={onHoverEnd}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") {
          // Left button only, and don't steal text selection from search.
          if (e.button !== 0) return;
          e.preventDefault();
          onMouseDrag();
          return;
        }
        startTouch(e);
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlace();
        }
      }}
      className={cn(
        "group relative flex h-full cursor-grab select-none flex-col gap-2 rounded-[15px] border border-white/7 bg-white/[0.03] p-2 text-left [-webkit-touch-callout:none]",
        "transition-[background-color,transform,border-color] duration-200 active:cursor-grabbing",
        "md:flex-row md:items-center md:gap-3 md:border-transparent md:bg-transparent md:hover:bg-white/6",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        lifted && "scale-[0.97] border-accent/50 bg-accent/10",
      )}
    >
      <ProductThumb
        product={p}
        className="aspect-square w-full shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] md:size-14 md:w-auto md:group-hover:scale-110"
      />

      <div className="min-w-0 flex-1 px-0.5 md:px-0">
        <p className="line-clamp-2 text-[12.5px] font-medium leading-snug text-chalk md:line-clamp-1">
          {p.name}
        </p>
        <p className="mt-0.5 hidden truncate text-[11px] text-chalk-4 md:block">{p.brand}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {free ? (
            <span className="text-[11.5px] font-medium text-chalk-3">
              {p.isFurniture ? "Already yours" : "Your item"}
            </span>
          ) : (
            <span className="text-[12px] font-semibold text-chalk-2">{formatINR(p.price)}</span>
          )}
          <span className="truncate text-[10.5px] tabular-nums text-chalk-4">{formatDims(p)}</span>
        </div>
      </div>

      {/* Phones: edit sits in the tile's top-left corner, add in the top-right. */}
      {onEdit ? (
        <button
          aria-label={`Edit ${p.name}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="absolute left-3.5 top-3.5 grid size-8 place-items-center rounded-[9px] bg-ink-1/80 text-chalk-3 backdrop-blur transition-colors hover:bg-white/8 hover:text-chalk md:static md:order-last md:size-6 md:bg-transparent md:text-chalk-4"
        >
          <Pencil className="size-3.5 md:size-3" />
        </button>
      ) : (
        <Grip className="hidden size-3.5 shrink-0 text-chalk-4 opacity-0 transition-opacity group-hover:opacity-100 md:block" />
      )}
      <button
        aria-label={`Add ${p.name} to room`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onPlace();
        }}
        className="absolute right-3.5 top-3.5 grid size-9 place-items-center rounded-[11px] bg-accent text-black shadow-lg shadow-black/40 transition-all md:static md:size-7 md:shrink-0 md:rounded-[9px] md:bg-white/7 md:text-chalk-2 md:shadow-none md:hover:bg-accent md:hover:text-black"
      >
        <Plus className="size-4 md:size-3.5" strokeWidth={2.4} />
      </button>
    </div>
  );
}
