"use client";

import * as React from "react";
import { useThree } from "@react-three/fiber";
import { Vector2 } from "three";
import { isWallSurface } from "@/lib/placement/transform";
import { useStudio } from "@/lib/store/studio";
import { findOwner } from "./DragController";

/**
 * Two-finger twist to turn an item.
 *
 * Put two fingers on the room with at least one of them on an item and twist:
 * the item turns with your fingers, like a photo on a table. Floor and
 * tabletop items turn about their upright axis; wall items tilt on the wall.
 * Two fingers anywhere else still pan and pinch the camera as before.
 *
 * The gesture is decided the moment the second finger lands. Its events are
 * caught on the window before the canvas sees them, so neither the camera
 * controls nor a pick-up started by the first finger fight the twist.
 */

const ndc = new Vector2();
/** Within this of a quarter turn, the item settles on it. */
const SNAP = (5 * Math.PI) / 180;
const WALL_TILT = Math.PI / 4;

export function TwistController() {
  const { camera, gl, scene, raycaster } = useThree();

  React.useEffect(() => {
    const touches = new Map<number, { x: number; y: number }>();
    let twist: {
      itemId: string;
      ids: [number, number];
      startAngle: number;
      start: number;
      wall: boolean;
      recorded: boolean;
    } | null = null;

    const itemAt = (x: number, y: number): string | undefined => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      for (const h of raycaster.intersectObjects(scene.children, true)) {
        const owner = findOwner(h.object);
        if (owner.ghost || owner.hidden) continue;
        // The first solid thing under the finger: an item, or the room in front of it.
        return owner.itemId;
      }
      return undefined;
    };

    const angleOf = (ids: [number, number]) => {
      const a = touches.get(ids[0])!;
      const b = touches.get(ids[1])!;
      return Math.atan2(b.y - a.y, b.x - a.x);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (e.target !== gl.domElement && !twist) {
        // Only gestures that start on the room itself count.
        return;
      }
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (twist) {
        // A third finger is ignored while twisting.
        e.stopImmediatePropagation();
        return;
      }
      if (touches.size !== 2) return;

      const store = useStudio.getState();
      if (store.tool === "view") return;
      const ids = [...touches.keys()] as [number, number];
      const draftId = store.draft?.itemId;
      // A finger already holding an item (tap-and-drag) counts as being on it.
      const itemId =
        draftId ??
        itemAt(touches.get(ids[0])!.x, touches.get(ids[0])!.y) ??
        itemAt(touches.get(ids[1])!.x, touches.get(ids[1])!.y);
      if (!itemId) return;
      const item = store.items.find((i) => i.id === itemId);
      if (!item) return;

      e.stopImmediatePropagation();
      e.preventDefault();
      // Drop whatever the first finger had started; the twist owns the gesture.
      if (store.draft) store.cancelDraft();
      store.select(itemId);
      store.setInteracting(true);
      const wall = isWallSurface(item.surface);
      twist = {
        itemId,
        ids,
        startAngle: angleOf(ids),
        start: wall ? item.spin : item.yaw,
        wall,
        recorded: false,
      };
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!twist) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (!twist.ids.includes(e.pointerId)) return;

      let delta = angleOf(twist.ids) - twist.startAngle;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      // Screen angles run clockwise (y points down); a clockwise twist turns
      // the item clockwise as seen from above, or as seen facing the wall.
      let value = twist.start - delta;
      if (twist.wall) {
        value = Math.max(-WALL_TILT, Math.min(WALL_TILT, value));
      } else {
        value = Math.atan2(Math.sin(value), Math.cos(value));
      }
      const quarter = Math.round(value / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(value - quarter) < SNAP) value = quarter;

      const { updateItem } = useStudio.getState();
      // One undo step for the whole twist.
      updateItem(twist.itemId, twist.wall ? { spin: value } : { yaw: value }, !twist.recorded);
      twist.recorded = true;
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !touches.has(e.pointerId)) return;
      touches.delete(e.pointerId);
      if (!twist) return;
      if (twist.ids.includes(e.pointerId)) {
        const { itemId, recorded } = twist;
        twist = null;
        const store = useStudio.getState();
        store.setInteracting(false);
        // Settle it once: snap, and nudge it clear of anything it now overlaps.
        if (recorded) store.resolveItem(itemId);
      }
      // Lifts always pass through: the camera controls must see the finger
      // they were tracking go up, and ignore one they never saw.
    };

    window.addEventListener("pointerdown", onDown, { capture: true, passive: false });
    window.addEventListener("pointermove", onMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onUp, { capture: true });
    window.addEventListener("pointercancel", onUp, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", onDown, { capture: true });
      window.removeEventListener("pointermove", onMove, { capture: true });
      window.removeEventListener("pointerup", onUp, { capture: true });
      window.removeEventListener("pointercancel", onUp, { capture: true });
      if (twist) useStudio.getState().setInteracting(false);
    };
  }, [camera, gl, scene, raycaster]);

  return null;
}
