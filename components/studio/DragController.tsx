"use client";

import * as React from "react";
import { useThree } from "@react-three/fiber";
import { Matrix3, Vector2, Vector3, type Intersection, type Object3D } from "three";
import { productById } from "@/lib/catalog/source";
import { resolvePlacement } from "@/lib/placement/resolve";
import type { Ray, RayHit } from "@/lib/placement/types";
import type { SurfaceId, Vec3 } from "@/lib/room/types";
import { useStudio } from "@/lib/store/studio";

/**
 * Pointer-driven placement.
 *
 * HTML5 drag-and-drop can't report a position inside a WebGL canvas, so drags
 * are plain pointer events instead: the catalog card starts a draft, this
 * controller raycasts every pointermove, and the resolver turns each hit into
 * a snapped, collision-checked candidate. The same path serves dragging a new
 * product in and moving one that is already placed — the only difference is
 * whether the draft carries an `itemId`.
 */

const ndc = new Vector2();
const normalMatrix = new Matrix3();
const worldNormal = new Vector3();

/** Walk up the scene graph to whatever carries the id we care about. */
function findOwner(object: Object3D): {
  itemId?: string;
  surfaceId?: SurfaceId;
  ghost?: boolean;
  hidden?: boolean;
} {
  let node: Object3D | null = object;
  const out: { itemId?: string; surfaceId?: SurfaceId; ghost?: boolean; hidden?: boolean } = {};
  while (node) {
    const ud = node.userData ?? {};
    if (ud.ghost) out.ghost = true;
    if (!node.visible) out.hidden = true;
    if (!out.itemId && typeof ud.itemId === "string") out.itemId = ud.itemId;
    if (!out.surfaceId && typeof ud.surfaceId === "string") {
      out.surfaceId = ud.surfaceId as SurfaceId;
    }
    node = node.parent;
  }
  return out;
}

export function DragController() {
  const { camera, gl, scene, raycaster } = useThree();

  const draft = useStudio((s) => s.draft);
  const room = useStudio((s) => s.room);
  const items = useStudio((s) => s.items);
  const gridSnap = useStudio((s) => s.gridSnap);
  const updateDraft = useStudio((s) => s.updateDraft);
  const commitDraft = useStudio((s) => s.commitDraft);
  const cancelDraft = useStudio((s) => s.cancelDraft);

  // Latest values without re-binding listeners on every store change.
  const state = React.useRef({ draft, room, items, gridSnap });
  state.current = { draft, room, items, gridSnap };

  const resolveAt = React.useCallback(
    (clientX: number, clientY: number) => {
      const { draft: d, room: r, items: all, gridSnap: snap } = state.current;
      if (!d || !r) return;

      const product = productById(d.productId);
      if (!product) return;

      const rect = gl.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);

      const hits = raycaster.intersectObjects(scene.children, true) as Intersection[];

      let hit: RayHit | null = null;
      for (const h of hits) {
        const owner = findOwner(h.object);
        // Never let the preview, or the item being moved, be its own target.
        if (owner.ghost) continue;
        // three's raycaster ignores `visible`, so the walls and ceiling hidden
        // for the dollhouse view would otherwise swallow every ray aimed past
        // them — in orbit and top views, a lamp aimed at a desk would hit an
        // invisible wall first and land on the floor.
        if (owner.hidden) continue;
        if (d.itemId && owner.itemId === d.itemId) continue;
        if (!owner.itemId && !owner.surfaceId) continue;

        if (h.face) {
          normalMatrix.getNormalMatrix(h.object.matrixWorld);
          worldNormal.copy(h.face.normal).applyMatrix3(normalMatrix).normalize();
        } else {
          worldNormal.set(0, 1, 0);
        }

        hit = {
          point: [h.point.x, h.point.y, h.point.z],
          normal: [worldNormal.x, worldNormal.y, worldNormal.z],
          surfaceId: owner.surfaceId,
          itemId: owner.itemId,
        };
        break;
      }

      const ray: Ray = {
        origin: [raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z] as Vec3,
        direction: [
          raycaster.ray.direction.x,
          raycaster.ray.direction.y,
          raycaster.ray.direction.z,
        ] as Vec3,
      };

      // When moving an existing item, it must not collide with itself.
      const others = d.itemId ? all.filter((i) => i.id !== d.itemId) : all;
      const existing = d.itemId ? all.find((i) => i.id === d.itemId) : undefined;

      const result = resolvePlacement(product, {
        room: r,
        items: others,
        hit,
        ray,
        gridSnap: snap,
        yaw: existing?.yaw ?? 0,
        spin: existing?.spin ?? 0,
        scale: existing?.scale ?? 1,
        id: d.itemId,
      });

      updateDraft(result);
    },
    [camera, gl, scene, raycaster, updateDraft],
  );

  React.useEffect(() => {
    if (!draft) return;

    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      resolveAt(e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent) => {
      resolveAt(e.clientX, e.clientY);
      // Commit on the next tick so the resolve above lands in the store first.
      requestAnimationFrame(() => commitDraft());
      void e;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelDraft();
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cancelDraft);
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cancelDraft);
      window.removeEventListener("keydown", onKey);
    };
  }, [draft, resolveAt, commitDraft, cancelDraft]);

  return null;
}
