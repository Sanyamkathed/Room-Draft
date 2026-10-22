import type { PerspectiveCamera } from "three";
import type { RoomGeometry } from "@/lib/room/types";

/**
 * Configure a three.js camera to reproduce the room's REFERENCE viewpoint
 * exactly, letterboxed into whatever canvas it renders to.
 *
 * In quick mode that reference is the original photo; in full mode it is the
 * head-on view of the wall the user shot. Either way two things make this
 * harder than "set the fov and position":
 *
 *  1. The principal point may be off-centre — the single-photo reconstruction
 *     puts it at the solved vanishing point. A PerspectiveCamera's frustum is
 *     symmetric about its optical axis, so an off-centre principal point has
 *     to be expressed as a view offset out of a larger symmetric frame.
 *  2. The canvas rarely matches the reference aspect, so the frustum has to be
 *     widened (or heightened) by exactly the letterbox margin.
 *
 * Getting this right is what makes the before/after slider line up pixel for
 * pixel with the user's own photo — the single most convincing thing the app
 * does. An approximate camera here shows as the room "jumping" as the slider
 * crosses the seam.
 */
export function applyPhotoCamera(
  camera: PerspectiveCamera,
  room: RoomGeometry,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const imageAspect = room.imageAspect;
  const [vpx, vpy] = room.camera.principal;

  // Work in arbitrary "reference frame units"; only ratios matter.
  const W = 1000;
  const H = W / imageAspect;

  // Vertical fov is well-defined in both capture modes, so derive focal from it.
  const fovY = (room.camera.fovYDeg * Math.PI) / 180;
  const focal = H / 2 / Math.tan(fovY / 2);

  // Smallest frame centred on the optical axis that still contains the frame.
  const virtualW = 2 * Math.max(vpx, 1 - vpx) * W;
  const virtualH = 2 * Math.max(vpy, 1 - vpy) * H;

  // Where the reference frame sits inside that virtual frame.
  const photoX = virtualW / 2 - vpx * W;
  const photoY = virtualH / 2 - vpy * H;

  // Letterbox: grow the rendered region to the canvas aspect around the frame.
  const canvasAspect = canvasWidth / Math.max(1, canvasHeight);
  let renderW = W;
  let renderH = H;
  if (canvasAspect > imageAspect) renderW = H * canvasAspect;
  else renderH = W / canvasAspect;

  const offsetX = photoX - (renderW - W) / 2;
  const offsetY = photoY - (renderH - H) / 2;

  camera.fov = (2 * Math.atan(virtualH / 2 / focal) * 180) / Math.PI;
  camera.aspect = virtualW / virtualH;
  camera.setViewOffset(virtualW, virtualH, offsetX, offsetY, renderW, renderH);

  camera.position.set(...room.camera.position);
  camera.lookAt(...room.camera.target);
  camera.updateProjectionMatrix();
}

/**
 * Where the reference frame actually lands inside a canvas of the given size.
 *
 * `applyPhotoCamera` letterboxes it into the canvas, and the result is exactly
 * a `contain` fit of the reference aspect. Knowing that rect lets the
 * before/after overlay lay the original photo directly over the live render
 * with no second canvas — and lets an export crop away the letterbox.
 */
export function photoContainRect(
  canvasWidth: number,
  canvasHeight: number,
  imageAspect: number,
): { x: number; y: number; width: number; height: number } {
  const canvasAspect = canvasWidth / Math.max(1, canvasHeight);
  const width = canvasAspect > imageAspect ? canvasHeight * imageAspect : canvasWidth;
  const height = canvasAspect > imageAspect ? canvasHeight : canvasWidth / imageAspect;
  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
  };
}

/** Undo applyPhotoCamera so orbit/first-person modes get a normal frustum. */
export function clearPhotoCamera(
  camera: PerspectiveCamera,
  canvasWidth: number,
  canvasHeight: number,
  fov = 50,
): void {
  camera.clearViewOffset();
  camera.fov = fov;
  camera.aspect = canvasWidth / Math.max(1, canvasHeight);
  camera.updateProjectionMatrix();
}
