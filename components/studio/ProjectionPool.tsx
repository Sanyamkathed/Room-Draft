"use client";

import * as React from "react";
import { AdditiveBlending, Euler, Quaternion, Vector3 } from "three";
import { productById } from "@/lib/catalog/source";
import type { PlacedItem } from "@/lib/placement/types";
import type { RoomGeometry, SurfaceId, Vec3 } from "@/lib/room/types";
import { projectionTexture } from "@/lib/three/textures";

/**
 * The patch of light a projector lamp throws onto the room.
 *
 * three.js can project a texture through a SpotLight, but only via the light's
 * shadow camera — which makes it fiddly, costs a shadow map per lamp, and
 * silently renders nothing when the light's target isn't wired up exactly
 * right. Since the room is a known box, the honest and far more reliable route
 * is to intersect the beam with it directly and draw the pool where it lands.
 *
 * This is what makes a sunset lamp worth buying, so it needs to actually show:
 * the whole point of the product is the shape it puts on your wall.
 */

const ELEVATION = 0.62; // radians above horizontal — sunset lamps aim up a wall
const CONE_ANGLE = 0.5;

interface Hit {
  point: Vec3;
  surface: SurfaceId;
  distance: number;
}

/** First room surface the beam meets, walking out from inside the box. */
function castToRoom(origin: Vec3, dir: Vec3, room: RoomGeometry): Hit | null {
  const { width, height, depth } = room.dimensions;
  const planes: { surface: SurfaceId; axis: 0 | 1 | 2; value: number }[] = [
    { surface: "left", axis: 0, value: -width / 2 },
    { surface: "right", axis: 0, value: width / 2 },
    { surface: "floor", axis: 1, value: 0 },
    { surface: "ceiling", axis: 1, value: height },
    { surface: "back", axis: 2, value: -depth / 2 },
    { surface: "front", axis: 2, value: depth / 2 },
  ];

  let best: Hit | null = null;

  for (const p of planes) {
    const d = dir[p.axis];
    if (Math.abs(d) < 1e-6) continue;
    const t = (p.value - origin[p.axis]) / d;
    if (t <= 0.05) continue;

    const point: Vec3 = [
      origin[0] + dir[0] * t,
      origin[1] + dir[1] * t,
      origin[2] + dir[2] * t,
    ];

    // Reject intersections with the *extension* of a plane beyond the room.
    const tol = 0.02;
    if (point[0] < -width / 2 - tol || point[0] > width / 2 + tol) continue;
    if (point[1] < -tol || point[1] > height + tol) continue;
    if (point[2] < -depth / 2 - tol || point[2] > depth / 2 + tol) continue;

    if (!best || t < best.distance) best = { point, surface: p.surface, distance: t };
  }

  return best;
}

const SURFACE_NORMAL: Record<SurfaceId, Vec3> = {
  floor: [0, 1, 0],
  ceiling: [0, -1, 0],
  back: [0, 0, 1],
  front: [0, 0, -1],
  left: [1, 0, 0],
  right: [-1, 0, 0],
};

function Pool({
  item,
  room,
  colour,
  pattern,
  opacity,
}: {
  item: PlacedItem;
  room: RoomGeometry;
  colour: string;
  pattern: "sunset" | "galaxy" | "wash";
  opacity: number;
}) {
  const texture = React.useMemo(() => projectionTexture(pattern), [pattern]);

  const placement = React.useMemo(() => {
    // The lens sits a little above the lamp's base and aims up-and-forward,
    // rotated by however the user turned it.
    const origin: Vec3 = [item.position[0], item.position[1] + 0.12, item.position[2]];
    const forward = new Vector3(0, 0, -1).applyEuler(new Euler(0, item.yaw, 0));
    const dir = new Vector3(
      forward.x * Math.cos(ELEVATION),
      Math.sin(ELEVATION),
      forward.z * Math.cos(ELEVATION),
    ).normalize();

    const hit = castToRoom(origin, [dir.x, dir.y, dir.z], room);
    if (!hit) return null;

    const normal = SURFACE_NORMAL[hit.surface];
    // Lift it clear of the wall so it never z-fights with the room texture.
    const point: Vec3 = [
      hit.point[0] + normal[0] * 0.012,
      hit.point[1] + normal[1] * 0.012,
      hit.point[2] + normal[2] * 0.012,
    ];

    // A beam spreads with distance, and hitting a surface at an angle smears
    // the pool out — both of which a fixed-size decal would miss.
    const spread = hit.distance * Math.tan(CONE_ANGLE) * 2;
    const grazing = Math.abs(dir.dot(new Vector3(...normal)));
    const size = spread * (1 + (1 - Math.max(0.25, grazing)) * 1.4);

    const quaternion = new Quaternion().setFromUnitVectors(
      new Vector3(0, 0, 1),
      new Vector3(...normal),
    );

    return {
      point,
      quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w] as [
        number,
        number,
        number,
        number,
      ],
      size,
      // Light falls off, so a pool thrown across the room is fainter.
      strength: opacity * Math.max(0.25, Math.min(1, 2.6 / hit.distance)),
    };
  }, [item.position, item.yaw, room, opacity]);

  if (!placement) return null;

  return (
    <mesh
      position={placement.point}
      quaternion={placement.quaternion}
      renderOrder={-2}
    >
      <planeGeometry args={[placement.size, placement.size]} />
      <meshBasicMaterial
        map={texture}
        color={colour}
        transparent
        opacity={placement.strength}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Tags that mean "this thing throws a pattern", rather than just glowing. */
function patternFor(tags: string[]): "sunset" | "galaxy" | "wash" | null {
  if (tags.includes("galaxy") || tags.includes("stars")) return "galaxy";
  if (tags.includes("sunset") || tags.includes("projector")) return "sunset";
  return null;
}

export function ProjectionPools({
  items,
  room,
  intensity = 1,
}: {
  items: PlacedItem[];
  room: RoomGeometry;
  /** Scaled down over a photo-textured room, like every other light source. */
  intensity?: number;
}) {
  return (
    <>
      {items.map((item) => {
        const product = productById(item.productId);
        if (!product?.emissive) return null;
        const pattern = patternFor(product.tags);
        if (!pattern) return null;

        return (
          <Pool
            key={item.id}
            item={item}
            room={room}
            colour={product.emissive.color}
            pattern={pattern}
            opacity={0.85 * intensity}
          />
        );
      })}
    </>
  );
}
