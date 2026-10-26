"use client";

import * as React from "react";
import { Box3, Group, Mesh, Vector3, type MeshStandardMaterial, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { MountType } from "@/lib/catalog/types";
import { M } from "./shapes";

/**
 * A generated 3D model of the item itself (lib/catalog/imageTo3d.ts),
 * stretched to the item's real width, height and depth and seated on its
 * mount face like every other model: base on the floor, back on the wall.
 */

const parsed = new Map<string, Promise<Group>>();

function load(key: string, dataUrl: string): Promise<Group> {
  let p = parsed.get(key);
  if (!p) {
    p = new GLTFLoader().loadAsync(dataUrl).then((g) => {
      g.scene.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
          // A generated mesh's dense, slightly noisy surface shadows itself
          // in stripes ("acne"); it casts onto the room but doesn't receive.
          m.castShadow = true;
          m.receiveShadow = false;
          // Generated models carry a colour texture only; glTF's default for a
          // missing metalness is "fully metal", which renders them near-black.
          for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
            const std = mat as MeshStandardMaterial;
            if (std.isMeshStandardMaterial && !std.metalnessMap) {
              std.metalness = 0;
              std.roughness = Math.max(std.roughness, 0.8);
            }
          }
        }
      });
      return g.scene;
    });
    parsed.set(key, p);
    p.catch(() => parsed.delete(key));
  }
  return p;
}

export function MeshModel({
  cacheKey,
  dataUrl,
  dims,
  mount,
}: {
  cacheKey: string;
  dataUrl: string;
  dims: { w: number; h: number; d: number };
  mount: MountType;
}) {
  const [scene, setScene] = React.useState<Object3D | null>(null);
  React.useEffect(() => {
    let live = true;
    load(cacheKey, dataUrl)
      .then((g) => live && setScene(g.clone(true)))
      .catch(() => live && setScene(null));
    return () => {
      live = false;
    };
  }, [cacheKey, dataUrl]);

  // Fit the model's own box to the item's real size, then sit it on its
  // mount face.
  const fit = React.useMemo(() => {
    if (!scene) return null;
    scene.updateMatrixWorld(true);
    const box = new Box3().setFromObject(scene);
    const size = box.getSize(new Vector3());
    const s = new Vector3(M(dims.w) / Math.max(1e-6, size.x), M(dims.h) / Math.max(1e-6, size.y), M(dims.d) / Math.max(1e-6, size.z));
    const c = box.getCenter(new Vector3());
    const offset = new Vector3(-c.x * s.x, -c.y * s.y, -c.z * s.z);
    if (mount === "wall") offset.z = -box.min.z * s.z;
    else if (mount === "ceiling") offset.y = -box.max.y * s.y;
    else offset.y = -box.min.y * s.y;
    return { scale: s, offset };
  }, [scene, dims.w, dims.h, dims.d, mount]);

  if (!scene || !fit) return null;
  return (
    <group position={fit.offset} scale={fit.scale}>
      <primitive object={scene} />
    </group>
  );
}
