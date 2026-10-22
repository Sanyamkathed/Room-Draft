"use client";

import * as React from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
} from "three";
import { buildSurfaceMesh, hiddenSurfaces, isInsideRoom } from "@/lib/room/mesh";
import type {
  RoomCalibration,
  RoomGeometry,
  RoomSurface,
  SurfaceId,
  Vec3,
} from "@/lib/room/types";

/**
 * The user's room as real geometry.
 *
 * Each of the six planes is a subdivided grid whose vertices carry a UV and a
 * `coverage` weight. Where that UV comes from depends on how the room was
 * captured:
 *
 *   quick mode — one photo, projected from the reconstructed camera. Surfaces
 *     the camera only glimpsed at a grazing angle get stretched pixels, and
 *     the wall behind the photographer gets none at all.
 *   full mode  — every surface carries its OWN straight-on photo, mapped by a
 *     homography from the four corners the user marked. No shared camera, no
 *     grazing angles, no blank walls.
 *
 * Either way the material mixes photo texture against a flat palette colour by
 * coverage, so anything unphotographed fades into neutral painted surface
 * rather than smearing edge pixels across it.
 */

function makeGeometry(
  surface: RoomSurface,
  room: RoomGeometry,
  projection: Parameters<typeof buildSurfaceMesh>[2],
): BufferGeometry {
  const mesh = buildSurfaceMesh(surface, room, projection);
  const geom = new BufferGeometry();
  geom.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geom.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geom.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
  geom.setAttribute("coverage", new BufferAttribute(mesh.coverage, 1));
  geom.setAttribute("edgeDistance", new BufferAttribute(mesh.edgeDistance, 1));
  geom.setIndex(new BufferAttribute(mesh.indices, 1));
  geom.computeBoundingSphere();
  return geom;
}

function fallbackColourFor(surface: SurfaceId, palette: RoomGeometry["palette"]): string {
  if (surface === "floor") return palette.floor;
  if (surface === "ceiling") return palette.ceiling;
  return palette.wall;
}

/**
 * A standard PBR material with photo-coverage blending patched in.
 *
 * Patching `MeshStandardMaterial` rather than writing a raw shader keeps the
 * room inside three's lighting pipeline — it still receives shadows from the
 * objects placed on it and still reacts to the neon and lamps the user adds,
 * which a custom unlit shader would lose.
 */
function useRoomMaterial(
  surface: SurfaceId,
  palette: RoomGeometry["palette"],
  texture: Texture | null,
  photoTexture: boolean,
) {
  return React.useMemo(() => {
    const fallback = new Color(fallbackColourFor(surface, palette));
    const material = new MeshStandardMaterial({
      map: texture ?? undefined,
      color: 0xffffff,
      roughness: surface === "floor" ? 0.72 : 0.94,
      metalness: 0,
      side: DoubleSide,
    });

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uFallback = { value: fallback };
      shader.uniforms.uPhotoMix = { value: photoTexture && texture ? 1 : 0 };

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float coverage;\nattribute float edgeDistance;\nvarying float vCoverage;\nvarying float vEdge;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvCoverage = coverage;\nvEdge = edgeDistance;",
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform vec3 uFallback;\nuniform float uPhotoMix;\nvarying float vCoverage;\nvarying float vEdge;",
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
           float cov = clamp(vCoverage, 0.0, 1.0) * uPhotoMix;
           diffuseColor.rgb = mix(uFallback, diffuseColor.rgb, cov);

           // Corner shading. Darkens the last ~35cm into every junction, which
           // reads as real ambient occlusion AND softens the seam where a
           // slightly-off calibration puts the floor line in the wrong place —
           // a soft shadow in a corner is invisible, a hard mismatched line is
           // the first thing you notice.
           float corner = smoothstep(0.0, 0.35, vEdge);
           diffuseColor.rgb *= mix(0.74, 1.0, corner);`,
        );
    };

    // Without a distinct cache key three would reuse a program compiled for a
    // different fallback/mix combination across surfaces.
    material.customProgramCacheKey = () =>
      `room-${surface}-${photoTexture && texture ? 1 : 0}`;

    return material;
  }, [surface, palette, texture, photoTexture]);
}

function SurfacePlane({
  surface,
  room,
  projection,
  texture,
  photoTexture,
  hidden,
}: {
  surface: RoomSurface;
  room: RoomGeometry;
  projection: Parameters<typeof buildSurfaceMesh>[2];
  texture: Texture | null;
  photoTexture: boolean;
  hidden: boolean;
}) {
  const geometry = React.useMemo(
    () => makeGeometry(surface, room, projection),
    [surface, room, projection],
  );
  const material = useRoomMaterial(surface.id, room.palette, texture, photoTexture);

  React.useEffect(() => () => geometry.dispose(), [geometry]);
  React.useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh
      geometry={geometry}
      material={material}
      visible={!hidden}
      receiveShadow
      userData={{ surfaceId: surface.id, isRoom: true }}
    />
  );
}

/** Decoded photos, wrapped as three textures and cached by image id. */
function useImageTextures(images: Record<string, HTMLImageElement>) {
  const textures = React.useMemo(() => {
    const out: Record<string, Texture> = {};
    for (const [id, img] of Object.entries(images)) {
      const tex = new Texture(img);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 8;
      tex.minFilter = LinearMipmapLinearFilter;
      tex.magFilter = LinearFilter;
      // A quad dragged slightly outside the frame would otherwise wrap around
      // and tile the opposite edge of the photo across the wall.
      tex.wrapS = ClampToEdgeWrapping;
      tex.wrapT = ClampToEdgeWrapping;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      out[id] = tex;
    }
    return out;
  }, [images]);

  React.useEffect(
    () => () => {
      for (const t of Object.values(textures)) t.dispose();
    },
    [textures],
  );

  return textures;
}

export function RoomShell({
  room,
  calibration,
  images,
  primaryImageId,
  photoTexture,
}: {
  room: RoomGeometry;
  /** Quick mode only — the single-photo solve. */
  calibration: RoomCalibration | null;
  images: Record<string, HTMLImageElement>;
  /** Which image the quick-mode projection uses. */
  primaryImageId: string | null;
  photoTexture: boolean;
}) {
  const camera = useThree((s) => s.camera);
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const textures = useImageTextures(images);

  const primary = primaryImageId ? images[primaryImageId] : undefined;
  const projection = React.useMemo(
    () =>
      calibration && primary
        ? {
            calibration,
            imageWidth: primary.naturalWidth,
            imageHeight: primary.naturalHeight,
          }
        : null,
    [calibration, primary],
  );

  // Dollhouse culling: hide whichever walls sit between the viewer and the
  // room. Recomputed only when the set actually changes, so this is a cheap
  // comparison per frame rather than a state write.
  const lastKey = React.useRef("");
  useFrame(() => {
    const pos: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
    const inside = isInsideRoom(room, pos, -0.05);
    const next = hiddenSurfaces(room, pos, inside);
    const key = [...next].sort().join(",");
    if (key !== lastKey.current) {
      lastKey.current = key;
      setHidden(next);
    }
  });

  return (
    <group name="room-shell">
      {room.surfaces.map((s) => {
        const texture =
          s.texture.kind === "rectified"
            ? (textures[s.texture.imageId] ?? null)
            : s.texture.kind === "projected" && primaryImageId
              ? (textures[primaryImageId] ?? null)
              : null;

        return (
          <SurfacePlane
            key={s.id}
            surface={s}
            room={room}
            projection={projection}
            texture={texture}
            photoTexture={photoTexture}
            hidden={hidden.has(s.id)}
          />
        );
      })}
    </group>
  );
}
