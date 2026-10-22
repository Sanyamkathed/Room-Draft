"use client";

import * as React from "react";
import {
  BoxGeometry,
  CanvasTexture,
  EdgesGeometry,
  SRGBColorSpace,
  Texture,
  type Group,
} from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { Product } from "@/lib/catalog/types";
import { boxCentre, itemEuler, localBox } from "@/lib/placement/transform";
import type { PlacedItem } from "@/lib/placement/types";
import { rectifyToCanvas } from "@/lib/room/rectify";
import { contactShadowTexture } from "@/lib/three/textures";
import { useStudio } from "@/lib/store/studio";
import { ProductModel } from "./models/ProductModel";

const ACCENT = "#d8ff3c";
const BLOCKED = "#ff6b6b";

/**
 * Selection outline.
 *
 * Drawn from the item's own local bounding box so it rotates and scales with
 * the object — an axis-aligned helper would drift off a rotated poster and
 * make the selection look broken.
 */
/**
 * The traced photo region, flattened into a texture for the object's face.
 *
 * This is what makes traced furniture read as *theirs*: the box is generic,
 * but the face is a de-skewed crop of the wall photo they took. Rectifying
 * through the same homography the wall uses means the crop lands square even
 * though the original was shot at an angle.
 */
function useTraceTexture(
  item: PlacedItem,
  product: Product,
): Texture | null {
  const images = useStudio((s) => s.images);
  const [texture, setTexture] = React.useState<Texture | null>(null);

  const trace = item.trace;
  const dims = item.size ?? product.dims;
  const aspect = dims.w / Math.max(1, dims.h);

  React.useEffect(() => {
    if (!trace) {
      setTexture(null);
      return;
    }
    const img = images[trace.imageId];
    if (!img) {
      setTexture(null);
      return;
    }

    const width = Math.min(1024, Math.max(64, Math.round(aspect * 512)));
    const height = Math.min(1024, Math.max(64, Math.round(512)));
    const canvas = rectifyToCanvas(img, trace.quad, width, height, 10);
    if (!canvas) {
      setTexture(null);
      return;
    }

    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    setTexture(tex);

    return () => tex.dispose();
  }, [trace, images, aspect]);

  return texture;
}

/** Load an item's own product photo as a texture. */
function useCustomTexture(dataUrl?: string): Texture | null {
  const [texture, setTexture] = React.useState<Texture | null>(null);

  React.useEffect(() => {
    if (!dataUrl) {
      setTexture(null);
      return;
    }
    let disposed = false;
    let made: Texture | null = null;

    const img = new Image();
    img.onload = () => {
      if (disposed) return;
      made = new Texture(img);
      made.colorSpace = SRGBColorSpace;
      made.anisotropy = 8;
      made.needsUpdate = true;
      setTexture(made);
    };
    img.src = dataUrl;

    return () => {
      disposed = true;
      made?.dispose();
    };
  }, [dataUrl]);

  return texture;
}

function SelectionBox({
  product,
  scale,
  override,
  colour = ACCENT,
}: {
  product: Product;
  scale: number;
  override?: { w: number; h: number; d: number };
  colour?: string;
}) {
  const { geometry, centre } = React.useMemo(() => {
    const lb = localBox(product, scale, override);
    const size: [number, number, number] = [
      Math.max(lb.max[0] - lb.min[0], 0.004),
      Math.max(lb.max[1] - lb.min[1], 0.004),
      Math.max(lb.max[2] - lb.min[2], 0.004),
    ];
    const box = new BoxGeometry(...size);
    const edges = new EdgesGeometry(box);
    box.dispose();
    return { geometry: edges, centre: boxCentre(lb) };
  }, [product, scale, override]);

  React.useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry} position={centre} renderOrder={999}>
      <lineBasicMaterial
        color={colour}
        transparent
        opacity={0.95}
        depthTest={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}

/**
 * The soft dark patch where an object meets its surface.
 *
 * Over a photo-textured room the directional light is turned right down — the
 * photo already contains its own lighting — so real shadows are too faint to
 * anchor anything, and every object reads as hovering a centimetre off the
 * floor. This is the cue that fixes it: cheap, always present, and scaled to
 * the object's actual footprint so a wardrobe grounds harder than a candle.
 */
function ContactShadow({
  product,
  scale,
  override,
}: {
  product: Product;
  scale: number;
  override?: { w: number; h: number; d: number };
}) {
  const tex = React.useMemo(() => contactShadowTexture(), []);
  const lb = React.useMemo(
    () => localBox(product, scale, override),
    [product, scale, override],
  );

  const w = lb.max[0] - lb.min[0];
  const d = lb.max[2] - lb.min[2];
  const height = lb.max[1] - lb.min[1];
  if (w < 0.01 || d < 0.01) return null;

  // Taller objects sit against their shadow more tightly; a low, wide thing
  // like a rug spreads its contact out.
  const spread = 1.35 + Math.min(0.5, height * 0.25);

  return (
    <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
      <planeGeometry args={[w * spread, d * spread]} />
      <meshBasicMaterial
        map={tex}
        transparent
        opacity={0.75}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

export interface PlacedObjectProps {
  item: PlacedItem;
  product: Product;
  selected: boolean;
  /** Whether this instance may create real lights (the scene caps the count). */
  light: boolean;
  /** Multiplier on any light it casts — turned down over a photo-textured room. */
  lightScale?: number;
  onPointerDown?: (e: ThreeEvent<PointerEvent>, item: PlacedItem) => void;
  /** Ghost preview — translucent, not interactive, tinted by validity. */
  ghost?: boolean;
  valid?: boolean;
}

/**
 * Ghost styling.
 *
 * Materials live inside each procedural model, so making the whole preview
 * translucent means walking the subtree after mount. The alternative — every
 * model accepting and threading a `ghost` prop into each of its materials —
 * would put presentation state into thirty components that should only be
 * describing geometry.
 */
function useGhostMaterials(ref: React.RefObject<Group | null>, ghost: boolean, valid: boolean) {
  React.useLayoutEffect(() => {
    const group = ref.current;
    if (!group || !ghost) return;

    const touched: { mat: import("three").Material; opacity: number; transparent: boolean; depthWrite: boolean }[] = [];

    group.traverse((child) => {
      const mesh = child as import("three").Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const m = mat as import("three").MeshStandardMaterial;
        touched.push({
          mat: m,
          opacity: m.opacity,
          transparent: m.transparent,
          depthWrite: m.depthWrite,
        });
        m.transparent = true;
        m.opacity = valid ? 0.62 : 0.4;
        m.depthWrite = false;
        if (!valid && "color" in m) m.color.set(BLOCKED);
      }
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });

    return () => {
      for (const t of touched) {
        const m = t.mat as import("three").MeshStandardMaterial;
        m.transparent = t.transparent;
        m.opacity = t.opacity;
        m.depthWrite = t.depthWrite;
      }
    };
  }, [ref, ghost, valid]);
}

export function PlacedObject({
  item,
  product,
  selected,
  light,
  lightScale = 1,
  onPointerDown,
  ghost = false,
  valid = true,
}: PlacedObjectProps) {
  const ref = React.useRef<Group>(null);
  useGhostMaterials(ref, ghost, valid);

  const traceTexture = useTraceTexture(item, product);
  const customTexture = useCustomTexture(item.customImage);
  const euler = React.useMemo(() => itemEuler(item, product), [item, product]);

  const handlePointerDown = React.useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (ghost || !onPointerDown) return;
      e.stopPropagation();
      onPointerDown(e, item);
    },
    [ghost, onPointerDown, item],
  );

  // Edge runs (LED strips, string lights) describe themselves in world space
  // via their path, so they must not inherit a mount transform.
  if (product.mount === "edge") {
    return (
      <group ref={ref} userData={{ itemId: ghost ? undefined : item.id }}>
        <group onPointerDown={handlePointerDown}>
          <ProductModel
            product={product}
            path={item.path}
            size={item.size}
            light={light && !ghost}
            lightScale={lightScale}
          />
        </group>
      </group>
    );
  }

  return (
    <group
      ref={ref}
      position={item.position}
      rotation={euler}
      scale={item.scale}
      userData={{ itemId: ghost ? undefined : item.id }}
    >
      {/* Floor and tabletop things need grounding; a poster on a wall does not. */}
      {!ghost && (product.mount === "floor" || product.mount === "tabletop") && (
        <ContactShadow product={product} scale={1} override={item.size} />
      )}

      <group onPointerDown={handlePointerDown}>
        <ProductModel
          product={product}
          size={item.size}
          traceTexture={traceTexture}
          customTexture={customTexture}
          light={light && !ghost}
          lightScale={lightScale}
        />
      </group>

      {(selected || (ghost && !valid)) && (
        <SelectionBox
          product={product}
          scale={1}
          override={item.size}
          colour={ghost && !valid ? BLOCKED : ACCENT}
        />
      )}
    </group>
  );
}
