"use client";

import { create } from "zustand";
import { productById } from "@/lib/catalog/source";
import type { AestheticId } from "@/lib/catalog/types";
import { resolvePlacement, settleItems } from "@/lib/placement/resolve";
import type { PlacedItem, PlacementResult } from "@/lib/placement/types";
import { buildRoomFromPlan } from "@/lib/room/plan";
import { reconstructRoom } from "@/lib/room/reconstruct";
import type {
  RoomCalibration,
  RoomGeometry,
  RoomPlan,
  SurfaceId,
  SurfacePhoto,
} from "@/lib/room/types";
import { storage } from "@/lib/storage/idb";
import type { Project } from "@/lib/storage/types";

export type CameraMode = "orbit" | "first" | "top" | "photo";
export type ToolMode = "select" | "move" | "rotate" | "scale";

/** Snapshot of the state undo cares about. */
interface Snapshot {
  items: PlacedItem[];
  calibration: RoomCalibration | null;
  plan: RoomPlan | null;
}

const HISTORY_LIMIT = 60;

interface StudioState {
  project: Project | null;
  room: RoomGeometry | null;
  /**
   * Decoded photos by image id. Not persisted — rebuilt from the stored data
   * URLs on load. Quick mode has one; full mode has up to six.
   */
  images: Record<string, HTMLImageElement>;

  items: PlacedItem[];
  /** Quick mode: the single-photo solve. Null in full mode. */
  calibration: RoomCalibration | null;
  /** Full mode: measured dimensions plus per-surface photos. Null in quick mode. */
  plan: RoomPlan | null;
  selectedId: string | null;

  cameraMode: CameraMode;
  tool: ToolMode;
  gridSnap: boolean;
  showOriginal: boolean;
  /** Photo texture vs. clean studio materials. */
  photoTexture: boolean;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;

  /**
   * The in-flight drag. Covers both cases with one shape: dragging a product
   * in from the catalog (no `itemId`) and moving an item that is already
   * placed (`itemId` set, original hidden while the ghost follows the cursor).
   */
  draft: {
    productId: string;
    itemId?: string;
    result: PlacementResult | null;
  } | null;
  /** True while a pointer drag owns the viewport, so orbit controls stand down. */
  interacting: boolean;

  past: Snapshot[];
  future: Snapshot[];
  dirty: boolean;

  /* actions */
  load: (project: Project, images: Record<string, HTMLImageElement>) => void;
  reset: () => void;
  setCalibration: (cal: RoomCalibration) => void;
  commitCalibration: () => void;
  setPlan: (plan: RoomPlan) => void;
  setRoomDimensions: (dims: RoomPlan["dimensions"]) => void;
  setSurfacePhoto: (surface: SurfaceId, photo: SurfacePhoto | null) => void;
  addImage: (id: string, image: HTMLImageElement) => void;

  beginDraft: (productId: string, itemId?: string) => void;
  updateDraft: (result: PlacementResult | null) => void;
  cancelDraft: () => void;
  commitDraft: () => string | null;
  setInteracting: (v: boolean) => void;

  addItemAt: (productId: string, item: PlacedItem) => void;
  updateItem: (id: string, patch: Partial<PlacedItem>, record?: boolean) => void;
  /** Re-run snapping and collision for one item — used when a slider is released. */
  resolveItem: (id: string) => void;
  moveItem: (id: string, result: PlacementResult) => void;
  removeItem: (id: string) => void;
  duplicateItem: (id: string) => void;
  clearItems: () => void;

  select: (id: string | null) => void;
  setCameraMode: (mode: CameraMode) => void;
  setTool: (tool: ToolMode) => void;
  toggleGridSnap: () => void;
  setShowOriginal: (v: boolean) => void;
  setPhotoTexture: (v: boolean) => void;
  setLeftPanel: (v: boolean) => void;
  setRightPanel: (v: boolean) => void;
  setAesthetic: (a: AestheticId | null) => void;

  undo: () => void;
  redo: () => void;
  save: (thumbnail?: string) => Promise<void>;
  rename: (name: string) => void;
}

/**
 * Build the room from whichever capture mode this project used.
 *
 * Both paths produce the same `RoomGeometry`, so nothing downstream — the
 * viewport, placement, the assistant, the before/after — has to know which
 * one it came from.
 */
function rebuildRoom(
  project: Project,
  calibration: RoomCalibration | null,
  plan: RoomPlan | null,
): RoomGeometry | null {
  if (project.mode === "full" && plan) {
    return buildRoomFromPlan(plan, project.palette);
  }
  const source = project.images[0];
  if (!calibration || !source) return null;
  return reconstructRoom(calibration, source.width, source.height, project.palette);
}

export const useStudio = create<StudioState>((set, get) => {
  /** Push the current state onto the undo stack before mutating it. */
  const record = () => {
    const { items, calibration, plan, past } = get();
    const snap: Snapshot = { items, calibration, plan };
    set({
      past: [...past.slice(-(HISTORY_LIMIT - 1)), snap],
      future: [],
      dirty: true,
    });
  };

  const applySnapshot = (snap: Snapshot) => {
    const { project } = get();
    set({
      items: snap.items,
      calibration: snap.calibration,
      plan: snap.plan,
      room: project
        ? rebuildRoom(project, snap.calibration, snap.plan) ?? get().room
        : get().room,
      selectedId: null,
      dirty: true,
    });
  };

  return {
    project: null,
    room: null,
    images: {},
    items: [],
    calibration: null,
    plan: null,
    selectedId: null,
    cameraMode: "orbit",
    tool: "select",
    gridSnap: true,
    showOriginal: false,
    photoTexture: true,
    leftPanelOpen: true,
    // The inspector has nothing to show until something is selected, and it
    // costs the viewport 286px — so it opens on selection rather than by default.
    rightPanelOpen: false,
    draft: null,
    interacting: false,
    past: [],
    future: [],
    dirty: false,

    load: (project, images) =>
      set({
        project,
        images,
        items: project.items,
        calibration: project.calibration ?? null,
        plan: project.plan ?? null,
        room: rebuildRoom(project, project.calibration ?? null, project.plan ?? null),
        selectedId: null,
        past: [],
        future: [],
        dirty: false,
        draft: null,
        cameraMode: "orbit",
      }),

    reset: () =>
      set({
        project: null,
        room: null,
        images: {},
        items: [],
        calibration: null,
        plan: null,
        selectedId: null,
        past: [],
        future: [],
        draft: null,
        dirty: false,
      }),

    // Live calibration drags update geometry without flooding the undo stack;
    // commitCalibration records the single resulting change.
    setCalibration: (cal) => {
      const { project, plan } = get();
      if (!project) return;
      set({
        calibration: cal,
        room: rebuildRoom(project, cal, plan) ?? get().room,
        dirty: true,
      });
    },

    setPlan: (plan) => {
      const { project, calibration } = get();
      if (!project) return;
      set({
        plan,
        room: rebuildRoom(project, calibration, plan) ?? get().room,
        dirty: true,
      });
    },

    setRoomDimensions: (dimensions) => {
      const { plan } = get();
      if (!plan) return;
      get().setPlan({ ...plan, dimensions });
    },

    setSurfacePhoto: (surface, photo) => {
      const { plan } = get();
      if (!plan) return;
      const surfaces = { ...plan.surfaces };
      if (photo) surfaces[surface] = photo;
      else delete surfaces[surface];
      get().setPlan({ ...plan, surfaces });
    },

    addImage: (id, image) =>
      set((s) => ({ images: { ...s.images, [id]: image } })),

    commitCalibration: () => {
      const { items, calibration, plan, past } = get();
      set({
        past: [...past.slice(-(HISTORY_LIMIT - 1)), { items, calibration, plan }],
        future: [],
      });
    },

    beginDraft: (productId, itemId) =>
      set({
        draft: { productId, itemId, result: null },
        selectedId: itemId ?? null,
        interacting: true,
      }),

    updateDraft: (result) => {
      const draft = get().draft;
      if (!draft) return;
      set({ draft: { ...draft, result } });
    },

    cancelDraft: () => set({ draft: null, interacting: false }),

    commitDraft: () => {
      const { draft, items } = get();
      if (!draft?.result?.valid) {
        set({ draft: null, interacting: false });
        return null;
      }
      record();
      const item = draft.result.item;

      // A move replaces the item in place; a fresh drop appends. Either way the
      // whole set is re-settled so anything resting on the moved object follows.
      const next = draft.itemId
        ? items.map((i) => (i.id === draft.itemId ? { ...item, id: draft.itemId! } : i))
        : [...items, item];

      set({
        items: settleItems(next),
        draft: null,
        interacting: false,
        selectedId: draft.itemId ?? item.id,
        rightPanelOpen: true,
      });
      return draft.itemId ?? item.id;
    },

    setInteracting: (interacting) => set({ interacting }),

    addItemAt: (productId, item) => {
      record();
      set((s) => ({
        items: settleItems([...s.items, { ...item, productId }]),
        selectedId: item.id,
      }));
    },

    updateItem: (id, patch, shouldRecord = true) => {
      if (shouldRecord) record();
      set((s) => ({
        items: settleItems(s.items.map((i) => (i.id === id ? { ...i, ...patch } : i))),
      }));
    },

    // Manual transform edits stay perfectly responsive while a slider is being
    // dragged, then get snapped and de-collided once on release. Running the
    // full resolver on every input event would make the sliders feel sticky.
    resolveItem: (id) => {
      const { items, room, gridSnap } = get();
      const item = items.find((i) => i.id === id);
      if (!item || !room) return;
      const product = productById(item.productId);
      if (!product) return;

      const resolved = resolvePlacement(product, {
        room,
        items: items.filter((i) => i.id !== id),
        hit: {
          point: item.position,
          normal: item.surface
            ? item.surface === "floor"
              ? [0, 1, 0]
              : item.surface === "ceiling"
                ? [0, -1, 0]
                : [0, 0, 1]
            : [0, 1, 0],
          surfaceId: item.surface ?? undefined,
          itemId: item.supportId ?? undefined,
        },
        ray: null,
        gridSnap,
        yaw: item.yaw,
        spin: item.spin,
        scale: item.scale,
        id,
      });

      if (!resolved?.valid) return;
      set({
        items: settleItems(
          items.map((i) => (i.id === id ? { ...resolved.item, id } : i)),
        ),
      });
    },

    moveItem: (id, result) => {
      record();
      set((s) => ({
        items: settleItems(s.items.map((i) => (i.id === id ? result.item : i))),
      }));
    },

    removeItem: (id) => {
      record();
      set((s) => ({
        // Drop the item, then let anything it was holding up fall.
        items: settleItems(s.items.filter((i) => i.id !== id)),
        selectedId: s.selectedId === id ? null : s.selectedId,
      }));
    },

    duplicateItem: (id) => {
      const { items } = get();
      const original = items.find((i) => i.id === id);
      if (!original) return;
      const product = productById(original.productId);
      if (!product) return;

      record();

      // Offset along the surface the item lives on, then let the resolver
      // settle it — a duplicate lands *beside* the original, never inside it.
      const room = get().room;
      const copy: PlacedItem = {
        ...original,
        id: `item_${Math.random().toString(36).slice(2, 10)}`,
        createdAt: Date.now(),
      };

      const stepX = (product.dims.w / 100) * original.scale + 0.06;
      copy.position = [
        original.position[0] + (product.mount === "wall" && (original.surface === "left" || original.surface === "right") ? 0 : stepX),
        original.position[1],
        original.position[2] + (product.mount === "wall" && (original.surface === "left" || original.surface === "right") ? stepX : 0),
      ];

      if (room) {
        const resolved = resolvePlacement(product, {
          room,
          items,
          hit: {
            point: copy.position,
            normal: [0, 1, 0],
            surfaceId: original.surface ?? undefined,
          },
          ray: null,
          gridSnap: get().gridSnap,
          yaw: original.yaw,
          spin: original.spin,
          scale: original.scale,
          id: copy.id,
        });
        if (resolved?.valid) copy.position = resolved.item.position;
      }

      set({ items: settleItems([...items, copy]), selectedId: copy.id });
    },

    clearItems: () => {
      record();
      set({ items: [], selectedId: null });
    },

    select: (id) => set({ selectedId: id, rightPanelOpen: id ? true : get().rightPanelOpen }),
    setCameraMode: (cameraMode) => set({ cameraMode }),
    setTool: (tool) => set({ tool }),
    toggleGridSnap: () => set((s) => ({ gridSnap: !s.gridSnap })),
    setShowOriginal: (showOriginal) => set({ showOriginal }),
    setPhotoTexture: (photoTexture) => set({ photoTexture }),
    setLeftPanel: (leftPanelOpen) => set({ leftPanelOpen }),
    setRightPanel: (rightPanelOpen) => set({ rightPanelOpen }),
    setAesthetic: (aesthetic) => {
      const { project } = get();
      if (!project) return;
      set({ project: { ...project, aesthetic }, dirty: true });
    },

    undo: () => {
      const { past, future, items, calibration, plan } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      set({
        past: past.slice(0, -1),
        future: [{ items, calibration, plan }, ...future].slice(0, HISTORY_LIMIT),
      });
      applySnapshot(previous);
    },

    redo: () => {
      const { past, future, items, calibration, plan } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({
        past: [...past, { items, calibration, plan }].slice(-HISTORY_LIMIT),
        future: future.slice(1),
      });
      applySnapshot(next);
    },

    save: async (thumbnail) => {
      const { project, items, calibration, plan } = get();
      if (!project) return;
      const updated: Project = {
        ...project,
        items,
        calibration: calibration ?? undefined,
        plan: plan ?? undefined,
        updatedAt: Date.now(),
        thumbnail: thumbnail ?? project.thumbnail,
      };
      await storage.saveProject(updated);
      set({ project: updated, dirty: false });
    },

    rename: (name) => {
      const { project } = get();
      if (!project) return;
      set({ project: { ...project, name }, dirty: true });
    },
  };
});

/** Convenience selector — the currently selected item plus its product. */
export function useSelected() {
  const selectedId = useStudio((s) => s.selectedId);
  const items = useStudio((s) => s.items);
  const item = items.find((i) => i.id === selectedId) ?? null;
  const product = item ? productById(item.productId) ?? null : null;
  return { item, product };
}
