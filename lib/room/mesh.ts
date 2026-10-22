/**
 * Turns room surfaces into renderable geometry.
 *
 * Each surface is subdivided into a grid rather than drawn as two triangles.
 * That matters for both texture paths: mapping a 3D plane into a photo is a
 * *projective* transform, but a GPU interpolates vertex UVs affinely across
 * each triangle. On a strongly foreshortened floor those two disagree badly
 * and you get a visible crease along the diagonal. Subdividing and solving
 * every grid vertex exactly shrinks the per-cell error until it disappears.
 *
 * Every vertex also carries a `coverage` attribute — 1 where a photo actually
 * saw this point, 0 where none did. The room material uses it to dissolve from
 * photo texture into flat palette colour, so surfaces nobody photographed read
 * as deliberate painted wall instead of stretched edge pixels.
 */

import { applyHomography, unitSquareToQuad, type Mat3 } from "./homography";
import { projectToImage } from "./reconstruct";
import type { RoomCalibration, RoomGeometry, RoomSurface, Vec3 } from "./types";

export interface SurfaceMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  coverage: Float32Array;
  /**
   * Metres to the nearest edge of this surface, clamped to a small band.
   *
   * Real rooms are darker where two surfaces meet — light can't reach into a
   * corner. Shading that band does two jobs at once: it is the single biggest
   * cue that a box is a room rather than a cube, and it turns the seam at the
   * floor/wall junction from a hard mismatched line into a soft shadow, which
   * is exactly where a slightly-off calibration shows up worst.
   */
  edgeDistance: Float32Array;
  indices: Uint32Array;
}

/** Metres of surface per grid cell. Lower = finer mesh. */
const CELL_SIZE = 0.28;
const MIN_SEGMENTS = 6;
const MAX_SEGMENTS = 30;
/** Width of the soft fade at the edge of the photographed region, in UV. */
const COVERAGE_FEATHER = 0.035;

/**
 * A rectified surface is already square-on, so its texture needs far less
 * subdivision than a projected one — the homography is much gentler than a
 * full perspective projection across a grazing-angle wall.
 */
const RECTIFIED_CELL_SIZE = 0.75;

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function segmentsFor(len: number, cell: number): number {
  return Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, Math.ceil(len / cell)));
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Smooth 0→1 ramp on how far inside the photo frame a UV lands. */
function coverageAt(u: number, v: number): number {
  const du = Math.min(u, 1 - u);
  const dv = Math.min(v, 1 - v);
  const c = Math.min(clamp01(du / COVERAGE_FEATHER), clamp01(dv / COVERAGE_FEATHER));
  // smoothstep — a linear ramp shows a visible band where the fade begins
  return c * c * (3 - 2 * c);
}

/** Everything the projected (quick-mode) path needs, and the rectified one doesn't. */
export interface ProjectionContext {
  calibration: RoomCalibration;
  imageWidth: number;
  imageHeight: number;
}

export function buildSurfaceMesh(
  surface: RoomSurface,
  room: RoomGeometry,
  projection: ProjectionContext | null,
): SurfaceMesh {
  const [c0, c1, c2, c3] = surface.corners;
  const kind = surface.texture.kind;

  const cell = kind === "rectified" ? RECTIFIED_CELL_SIZE : CELL_SIZE;
  // Grid resolution follows the surface's real extent, so a 5m wall gets more
  // cells than a 2m one instead of every surface paying the same cost.
  const su = segmentsFor(Math.max(dist3(c0, c1), dist3(c3, c2)), cell);
  const sv = segmentsFor(Math.max(dist3(c0, c3), dist3(c1, c2)), cell);

  const vertexCount = (su + 1) * (sv + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const coverage = new Float32Array(vertexCount);
  const edgeDistance = new Float32Array(vertexCount);

  // The surface's own photo maps its unit square straight onto the marked quad.
  const homography: Mat3 | null =
    surface.texture.kind === "rectified"
      ? unitSquareToQuad(surface.texture.quad)
      : null;

  const n = surface.normal;
  // Real extent of this surface, so the corner band is a fixed number of
  // centimetres rather than a fraction of however big the wall happens to be.
  const spanU = Math.max(dist3(c0, c1), dist3(c3, c2));
  const spanV = Math.max(dist3(c0, c3), dist3(c1, c2));
  let p = 0;

  for (let j = 0; j <= sv; j++) {
    const t = j / sv;
    for (let i = 0; i <= su; i++) {
      const s = i / su;

      // Bilinear across the quad: (0,0)=TL (1,0)=TR (1,1)=BR (0,1)=BL
      const top = lerp3(c0, c1, s);
      const bottom = lerp3(c3, c2, s);
      const pos = lerp3(top, bottom, t);

      positions[p * 3] = pos[0];
      positions[p * 3 + 1] = pos[1];
      positions[p * 3 + 2] = pos[2];

      edgeDistance[p] = Math.min(
        Math.min(s, 1 - s) * spanU,
        Math.min(t, 1 - t) * spanV,
      );

      normals[p * 3] = n[0];
      normals[p * 3 + 1] = n[1];
      normals[p * 3 + 2] = n[2];

      if (homography) {
        const [ix, iy] = applyHomography(homography, [s, t]);
        uvs[p * 2] = ix;
        // Image space runs top-down; WebGL texture space runs bottom-up.
        uvs[p * 2 + 1] = 1 - iy;
        coverage[p] = coverageAt(ix, iy);
      } else if (kind === "projected" && projection) {
        const proj = projectToImage(
          pos,
          room,
          projection.calibration,
          projection.imageWidth,
          projection.imageHeight,
        );
        uvs[p * 2] = proj.u;
        uvs[p * 2 + 1] = proj.v;
        // Points behind the camera project to a mirrored, meaningless UV.
        coverage[p] = proj.depth > 0.02 ? coverageAt(proj.u, 1 - proj.v) : 0;
      } else {
        uvs[p * 2] = s;
        uvs[p * 2 + 1] = 1 - t;
        coverage[p] = 0;
      }

      p++;
    }
  }

  const indices = new Uint32Array(su * sv * 6);
  let k = 0;
  for (let j = 0; j < sv; j++) {
    for (let i = 0; i < su; i++) {
      const a = j * (su + 1) + i;
      const b = a + 1;
      const c = a + su + 2;
      const d = a + su + 1;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = d;
    }
  }

  return { positions, normals, uvs, coverage, edgeDistance, indices };
}

/**
 * Which room surfaces should be hidden so the camera can see inside.
 *
 * Standard dollhouse behaviour: a wall whose inward normal points *away* from
 * the viewer is between the viewer and the room, so it gets culled. Done per
 * frame this makes orbiting feel like handling a physical model.
 */
export function hiddenSurfaces(
  room: RoomGeometry,
  cameraPos: Vec3,
  insideRoom: boolean,
): Set<string> {
  const hidden = new Set<string>();
  if (insideRoom) return hidden;

  for (const s of room.surfaces) {
    const mid = s.corners.reduce(
      (acc, c) => [acc[0] + c[0] / 4, acc[1] + c[1] / 4, acc[2] + c[2] / 4] as Vec3,
      [0, 0, 0] as Vec3,
    );
    const toCam: Vec3 = [
      cameraPos[0] - mid[0],
      cameraPos[1] - mid[1],
      cameraPos[2] - mid[2],
    ];
    const dot = toCam[0] * s.normal[0] + toCam[1] * s.normal[1] + toCam[2] * s.normal[2];
    if (dot < 0) hidden.add(s.id);
  }

  // Never hide the floor — a floating room reads as broken, not as a cutaway.
  hidden.delete("floor");
  return hidden;
}

/** Is a point inside the room volume (with a small tolerance)? */
export function isInsideRoom(room: RoomGeometry, p: Vec3, tol = 0.05): boolean {
  const { width, height, depth } = room.dimensions;
  return (
    p[0] > -width / 2 - tol &&
    p[0] < width / 2 + tol &&
    p[1] > -tol &&
    p[1] < height + tol &&
    p[2] > -depth / 2 - tol &&
    p[2] < depth / 2 + tol
  );
}
