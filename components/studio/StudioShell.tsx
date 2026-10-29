"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Columns2,
  Download,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { SHEET_HEIGHT, useStudio, type SheetSize } from "@/lib/store/studio";
import { downloadDataUrl } from "@/lib/utils/image";
import { storage } from "@/lib/storage/idb";
import { Button, IconButton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";
import { ArMode } from "./ArMode";
import { AssistantPanel } from "./AssistantPanel";
import { BeforeAfter } from "./BeforeAfter";
import { BottomToolbar } from "./BottomToolbar";
import { FurnitureTracer } from "./FurnitureTracer";
import { LeftPanel } from "./LeftPanel";
import { RightPanel } from "./RightPanel";
import { Viewport } from "./Viewport";

/**
 * The Design Studio.
 *
 * The 3D viewport owns the screen and everything else floats over or beside
 * it; both side panels collapse to a pill so the room can go full-bleed. On
 * mobile the panels become bottom sheets rather than being cut down, because a
 * 312px library squeezed into a 380px viewport leaves nothing for the room.
 */
export function StudioShell() {
  const project = useStudio((s) => s.project);
  const items = useStudio((s) => s.items);
  const dirty = useStudio((s) => s.dirty);
  const save = useStudio((s) => s.save);
  const rename = useStudio((s) => s.rename);
  const clearItems = useStudio((s) => s.clearItems);
  const selectedId = useStudio((s) => s.selectedId);
  const removeItem = useStudio((s) => s.removeItem);
  const duplicateItem = useStudio((s) => s.duplicateItem);
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  const select = useStudio((s) => s.select);
  const leftOpen = useStudio((s) => s.leftPanelOpen);
  const setLeftOpen = useStudio((s) => s.setLeftPanel);
  // A Pin sent from the inspo feed opens in the item maker, which lives in the left panel.
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).has("pin")) setLeftOpen(true);
  }, [setLeftOpen]);
  const rightOpen = useStudio((s) => s.rightPanelOpen);
  const setRightOpen = useStudio((s) => s.setRightPanel);
  const sheetSize = useStudio((s) => s.sheetSize);
  const setSheetSize = useStudio((s) => s.setSheetSize);
  const draft = useStudio((s) => s.draft);
  // View mode on a phone: the sheets step aside and the room gets the screen.
  const viewing = useStudio((s) => s.tool === "view");
  // Live height while the handle is being dragged; snaps on release.
  const [dragHeight, setDragHeight] = React.useState<number | null>(null);
  const sheetFraction = dragHeight ?? SHEET_HEIGHT[sheetSize];

  // Placing something from the sheet needs the room, not the list: shrink the
  // sheet out of the way while a new item is being dragged in.
  React.useEffect(() => {
    if (draft && !draft.itemId && window.matchMedia("(max-width: 767px)").matches) {
      setSheetSize("peek");
    }
  }, [draft, setSheetSize]);

  const [overlay, setOverlay] = React.useState<
    "none" | "assistant" | "compare" | "ar" | "trace"
  >("none");
  /** Below md the panels are bottom sheets that the 3D view must sit above. */
  const sheetOpen = !viewing && (leftOpen || (rightOpen && Boolean(selectedId)));
  const [saving, setSaving] = React.useState(false);
  const [justSaved, setJustSaved] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const router = useRouter();

  /**
   * Delete this whole space. The store is reset first so no pending autosave
   * can write the room back after it's gone.
   */
  const deleteSpace = React.useCallback(async () => {
    const id = useStudio.getState().project?.id;
    if (!id) return;
    useStudio.getState().reset();
    await storage.deleteProject(id);
    router.replace("/spaces");
  }, [router]);

  const grabCanvas = React.useCallback((): string | undefined => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-engine]");
    if (!canvas) return undefined;
    try {
      const out = document.createElement("canvas");
      const scale = Math.min(1, 640 / canvas.width);
      out.width = Math.round(canvas.width * scale);
      out.height = Math.round(canvas.height * scale);
      out.getContext("2d")?.drawImage(canvas, 0, 0, out.width, out.height);
      return out.toDataURL("image/jpeg", 0.72);
    } catch {
      return undefined;
    }
  }, []);

  /**
   * Thumbnail of the room as designed — not as currently being edited.
   *
   * The selection outline is part of the editing UI, and a lime wireframe box
   * frozen into a project card reads as a rendering fault. So the selection is
   * dropped for the two frames it takes to repaint, then restored.
   *
   * The frame wait is raced against a timer because requestAnimationFrame does
   * not fire in a hidden tab. Awaiting it bare means that switching away
   * mid-edit leaves this promise pending forever and the autosave behind it
   * never runs — losing exactly the work the user walked away from.
   */
  const snapshot = React.useCallback(async (): Promise<string | undefined> => {
    const previous = useStudio.getState().selectedId;
    if (!previous) return grabCanvas();

    select(null);
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      requestAnimationFrame(() => requestAnimationFrame(done));
      setTimeout(done, 250);
    });
    const data = grabCanvas();
    select(previous);
    return data;
  }, [grabCanvas, select]);

  const doSave = React.useCallback(async () => {
    setSaving(true);
    await save(await snapshot());
    setSaving(false);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1800);
  }, [save, snapshot]);

  // Autosave: quiet, debounced, and never while an overlay is capturing the
  // canvas for something else.
  React.useEffect(() => {
    if (!dirty || overlay !== "none") return;
    const t = setTimeout(() => void snapshot().then((thumb) => save(thumb)), 2500);
    return () => clearTimeout(t);
  }, [dirty, items, overlay, save, snapshot]);

  // Keyboard shortcuts — the studio is a tool, and tools have shortcuts.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void doSave();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        removeItem(selectedId);
      } else if (mod && e.key.toLowerCase() === "d" && selectedId) {
        e.preventDefault();
        duplicateItem(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, doSave, selectedId, removeItem, duplicateItem]);

  const exportPng = React.useCallback(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-engine]");
    if (!canvas) return;
    downloadDataUrl(
      canvas.toDataURL("image/png"),
      `${(project?.name ?? "roomdraft-room").replace(/\s+/g, "-").toLowerCase()}.png`,
    );
  }, [project?.name]);

  return (
    // The studio is a tool surface, not a document: no text selection and no
    // long-press callout, or holding and dragging an item highlights the whole
    // page on a phone. Text fields opt back in.
    <div
      className="flex h-dvh select-none flex-col overflow-hidden bg-ink-0 [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text"
      style={{ ["--sheet" as string]: `${Math.round(sheetFraction * 1000) / 10}%` }}
    >
      {/* ---------------- Top bar ---------------- */}
      <header className="z-40 flex h-[56px] shrink-0 items-center gap-3 border-b border-white/8 bg-ink-1/80 px-3 backdrop-blur-xl">
        <Link
          href="/spaces"
          aria-label="Back to my spaces"
          className="grid size-9 shrink-0 place-items-center rounded-[10px] text-chalk-2 transition-colors hover:bg-white/8 hover:text-chalk"
        >
          <ArrowLeft className="size-4.5" />
        </Link>

        <div className="min-w-0 flex-1">
          <input
            value={project?.name ?? ""}
            onChange={(e) => rename(e.target.value)}
            aria-label="Project name"
            className="w-full max-w-[320px] truncate rounded-[8px] bg-transparent px-1.5 py-0.5 text-[14px] font-semibold tracking-[-0.02em] text-chalk outline-none transition-colors hover:bg-white/5 focus:bg-white/8"
          />
          <p className="px-1.5 text-[11px] text-chalk-4">
            {items.length} {items.length === 1 ? "item" : "items"}
            {dirty ? " · unsaved" : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {confirmClear ? (
            <div className="flex items-center gap-1 rounded-[10px] bg-danger/12 p-1">
              {items.length > 0 && (
                <button
                  onClick={() => {
                    clearItems();
                    setConfirmClear(false);
                  }}
                  className="rounded-[7px] px-2 py-1 text-[11.5px] font-semibold text-danger hover:bg-danger/15"
                >
                  Clear items
                </button>
              )}
              <button
                onClick={() => void deleteSpace()}
                className="rounded-[7px] px-2 py-1 text-[11.5px] font-semibold text-danger hover:bg-danger/15"
              >
                Delete space
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="rounded-[7px] px-2 py-1 text-[11.5px] text-chalk-2 hover:bg-white/8"
              >
                Cancel
              </button>
            </div>
          ) : (
            <IconButton
              label="Clear items or delete this space"
              size="sm"
              tone="danger"
              onClick={() => setConfirmClear(true)}
            >
              <Trash2 className="size-4" />
            </IconButton>
          )}

          <IconButton label="Export a PNG" size="sm" onClick={exportPng}>
            <Download className="size-4" />
          </IconButton>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOverlay("compare")}
            className="hidden sm:inline-flex"
          >
            <Columns2 className="size-3.5" />
            Before / after
          </Button>

          <Button
            variant={overlay === "assistant" ? "primary" : "secondary"}
            size="sm"
            onClick={() => setOverlay(overlay === "assistant" ? "none" : "assistant")}
          >
            <Sparkles className="size-3.5" />
            <span className="hidden sm:inline">Assistant</span>
          </Button>

          <Button variant="primary" size="sm" onClick={() => void doSave()} loading={saving}>
            {justSaved ? (
              <>
                <Check className="size-3.5" strokeWidth={2.8} />
                Saved
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </header>

      {/* ---------------- Body ---------------- */}
      <div className="relative flex min-h-0 flex-1">
        {/* Each panel is ONE instance that changes position responsively —
            a bottom sheet on phones, a side rail from md up. Rendering a
            desktop copy and a mobile copy would duplicate an 88-item list in
            the DOM and double every handler attached to it. */}
        {leftOpen && (
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 z-30 flex h-[var(--sheet)] flex-col overflow-hidden rounded-t-[22px] border-t border-white/12 bg-ink-1",
              viewing && "max-md:hidden",
              dragHeight === null && "transition-[height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
              "md:static md:inset-auto md:z-auto md:h-full md:shrink-0 md:rounded-none md:border-t-0 md:bg-transparent",
            )}
          >
            <SheetHandle size={sheetSize} onSize={setSheetSize} onDrag={setDragHeight} />
            <div className="min-h-0 flex-1">
              <LeftPanel onTrace={() => setOverlay("trace")} />
            </div>
          </div>
        )}

        <div className="relative min-w-0 flex-1 order-first md:order-none">
          {/* AR opens its own full-screen WebGL canvas, and two live contexts
              on a modest GPU is enough to get one dropped ("Context Lost").
              Nothing shows behind it anyway, so the studio's canvas stands
              down. Before/after deliberately reuses THIS canvas instead.

              On phones the panels are bottom sheets, so the canvas ends where
              the sheet begins. Letting it run full-height instead would centre
              the room behind the sheet, leaving the user looking at an empty
              ceiling with their room hidden under the controls. */}
          {overlay !== "ar" && (
            // The wrapper does the positioning, not the Canvas: R3F sets an
            // inline height:100% on its own root element, which over-constrains
            // top/bottom and silently wins — the canvas would stay full height
            // and render the room behind the sheet.
            <div
              className={cn(
                "absolute inset-x-0 top-0 md:bottom-0",
                sheetOpen && overlay !== "compare" ? "bottom-[var(--sheet)]" : "bottom-0",
                dragHeight === null && "transition-[bottom] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
              )}
            >
              <Viewport className="size-full" />
            </div>
          )}

          {/* Floating chrome. The wrapper is pointer-events-none so the 3D
              scene keeps every event not aimed at an actual control. */}
          {/* On phones the chrome ends where the sheet begins, so the toolbar
              sits above the list instead of on top of it. */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 md:bottom-0",
              sheetOpen && overlay !== "compare" ? "bottom-[var(--sheet)]" : "bottom-0",
            )}
          >
            {!leftOpen && overlay !== "compare" && (
              <button
                onClick={() => setLeftOpen(true)}
                className="pointer-events-auto absolute left-3 top-3 inline-flex h-10 items-center gap-2 rounded-[12px] glass-strong px-3.5 text-[13px] font-medium text-chalk edge-light transition-all hover:bg-white/8"
              >
                <Sparkles className="size-4 text-accent" />
                Decor
              </button>
            )}

            {!rightOpen && selectedId && overlay !== "compare" && (
              <button
                onClick={() => setRightOpen(true)}
                className={cn(
                  "pointer-events-auto absolute right-3 top-3 inline-flex h-10 items-center gap-2",
                  "rounded-[12px] glass-strong px-3.5 text-[13px] font-medium text-chalk edge-light transition-all hover:bg-white/8",
                )}
              >
                <SlidersHorizontal className="size-3.5 text-accent" />
                Edit selection
              </button>
            )}

            {overlay !== "compare" && (
              <BottomToolbar onOpenAr={() => setOverlay("ar")} />
            )}
          </div>

          {/* Comparison renders over the live viewport, sharing its canvas. */}
          {overlay === "compare" && <BeforeAfter onClose={() => setOverlay("none")} />}
        </div>

        {/* Below md the inspector only takes over the screen once something is
            actually selected; on desktop it's a persistent rail. */}
        {rightOpen && (
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 z-30 flex h-[var(--sheet)] flex-col overflow-hidden rounded-t-[22px] border-t border-white/12 bg-ink-1",
              selectedId && !viewing ? "" : "hidden",
              dragHeight === null && "transition-[height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
              "md:static md:inset-auto md:z-auto md:flex md:h-full md:shrink-0 md:rounded-none md:border-t-0 md:bg-transparent",
            )}
          >
            <SheetHandle size={sheetSize} onSize={setSheetSize} onDrag={setDragHeight} />
            <div className="min-h-0 flex-1">
              <RightPanel />
            </div>
          </div>
        )}

        {overlay === "assistant" && <AssistantPanel onClose={() => setOverlay("none")} />}
      </div>

      {overlay === "ar" && <ArMode onClose={() => setOverlay("none")} />}
      {overlay === "trace" && <FurnitureTracer onClose={() => setOverlay("none")} />}
    </div>
  );
}

/**
 * The grab bar on a phone's bottom sheet. Drag to resize — it follows the
 * finger, then snaps to the nearest of peek / half / full — or tap to toggle
 * between peeking at the room and browsing.
 */
function SheetHandle({
  size,
  onSize,
  onDrag,
}: {
  size: SheetSize;
  onSize: (s: SheetSize) => void;
  onDrag: (fraction: number | null) => void;
}) {
  const start = React.useRef<{ y: number; frac: number; moved: boolean } | null>(null);

  const finish = (fraction: number | null) => {
    onDrag(null);
    if (fraction === null) return;
    const nearest = (Object.keys(SHEET_HEIGHT) as SheetSize[]).reduce((best, k) =>
      Math.abs(SHEET_HEIGHT[k] - fraction) < Math.abs(SHEET_HEIGHT[best] - fraction) ? k : best,
    );
    onSize(nearest);
  };

  return (
    <div
      role="separator"
      aria-label="Resize panel"
      aria-orientation="horizontal"
      className="flex h-6 shrink-0 cursor-row-resize touch-none items-center justify-center md:hidden"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, frac: SHEET_HEIGHT[size], moved: false };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const dy = e.clientY - s.y;
        if (Math.abs(dy) > 4) s.moved = true;
        if (!s.moved) return;
        const frac = Math.min(0.92, Math.max(0.2, s.frac - dy / window.innerHeight));
        onDrag(frac);
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (!s) return;
        if (!s.moved) {
          onDrag(null);
          onSize(size === "peek" ? "half" : "peek");
          return;
        }
        finish(Math.min(0.92, Math.max(0.2, s.frac - (e.clientY - s.y) / window.innerHeight)));
      }}
      onPointerCancel={() => {
        start.current = null;
        onDrag(null);
      }}
    >
      <span className="h-1.5 w-11 rounded-full bg-white/25" />
    </div>
  );
}
