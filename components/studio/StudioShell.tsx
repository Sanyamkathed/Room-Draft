"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Columns2,
  Download,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useStudio } from "@/lib/store/studio";
import { downloadDataUrl } from "@/lib/utils/image";
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
  const rightOpen = useStudio((s) => s.rightPanelOpen);
  const setRightOpen = useStudio((s) => s.setRightPanel);

  const [overlay, setOverlay] = React.useState<
    "none" | "assistant" | "compare" | "ar" | "trace"
  >("none");
  /** Below md the panels are bottom sheets that the 3D view must sit above. */
  const sheetOpen = leftOpen || (rightOpen && Boolean(selectedId));
  const [saving, setSaving] = React.useState(false);
  const [justSaved, setJustSaved] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);

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
      `${(project?.name ?? "aura-room").replace(/\s+/g, "-").toLowerCase()}.png`,
    );
  }, [project?.name]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ink-0">
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
          {items.length > 0 &&
            (confirmClear ? (
              <div className="flex items-center gap-1 rounded-[10px] bg-danger/12 p-1">
                <button
                  onClick={() => {
                    clearItems();
                    setConfirmClear(false);
                  }}
                  className="rounded-[7px] px-2 py-1 text-[11.5px] font-semibold text-danger hover:bg-danger/15"
                >
                  Clear all
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
                label="Clear the room"
                size="sm"
                tone="danger"
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 className="size-4" />
              </IconButton>
            ))}

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
              "absolute inset-x-0 bottom-0 z-30 h-[58%] overflow-hidden rounded-t-[22px] border-t border-white/12",
              "md:static md:inset-auto md:z-auto md:h-full md:shrink-0 md:rounded-none md:border-t-0",
            )}
          >
            <LeftPanel onTrace={() => setOverlay("trace")} />
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
                sheetOpen && overlay !== "compare" ? "bottom-[58%]" : "bottom-0",
              )}
            >
              <Viewport className="size-full" />
            </div>
          )}

          {/* Floating chrome. The wrapper is pointer-events-none so the 3D
              scene keeps every event not aimed at an actual control. */}
          <div className="pointer-events-none absolute inset-0">
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
              "absolute inset-x-0 bottom-0 z-30 h-[58%] overflow-hidden rounded-t-[22px] border-t border-white/12",
              selectedId ? "" : "hidden",
              "md:static md:inset-auto md:z-auto md:block md:h-full md:shrink-0 md:rounded-none md:border-t-0",
            )}
          >
            <RightPanel />
          </div>
        )}

        {overlay === "assistant" && <AssistantPanel onClose={() => setOverlay("none")} />}
      </div>

      {overlay === "ar" && <ArMode onClose={() => setOverlay("none")} />}
      {overlay === "trace" && <FurnitureTracer onClose={() => setOverlay("none")} />}
    </div>
  );
}
