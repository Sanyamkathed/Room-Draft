"use client";

import * as React from "react";
import {
  AdditiveBlending,
  DoubleSide,
  Shape,
  Vector2,
  Vector3,
  type Object3D,
  type SpotLight as ThreeSpotLight,
  type Texture,
} from "three";
import type { Product } from "@/lib/catalog/types";
import type { Vec3 } from "@/lib/room/types";
import {
  artworkTexture,
  canLabelTexture,
  checkerTexture,
  glowTexture,
  photoGridTexture,
  projectionTexture,
  weaveTexture,
} from "@/lib/three/textures";
import { FURNITURE_MODELS } from "./FurnitureModel";
import { M, catenary, leafShape, neonCurve, seededRandom } from "./shapes";

/**
 * Procedural geometry for every product in the catalog.
 *
 * Each model is authored at the product's TRUE dimensions in metres, with its
 * origin on the face that touches the world (see lib/placement/transform.ts).
 * The item's scale multiplier is applied by the parent group, so nothing here
 * has to know about it — a model that reads `product.dims` is automatically
 * correct at any scale.
 *
 * Geometry is deliberately low-poly and shares no external assets: the whole
 * catalog renders from primitives, lathes and a handful of canvas textures,
 * which is what keeps a room with 40 objects inside the frame budget.
 */

export interface ModelProps {
  product: Product;
  /** Edge-mounted runs receive their world-space path. */
  path?: [Vec3, Vec3];
  /** Whether this instance is allowed a real light (the scene caps how many). */
  light?: boolean;
  /**
   * Multiplier on any light this product casts. Over a photo-textured room
   * the photo already contains its own lighting, so a lamp at full strength
   * blows the wall next to it to white — the same reason the room's own rig
   * is turned down there.
   */
  lightScale?: number;
  /**
   * Real dimensions for this instance, in cm, overriding the catalogue entry.
   * Set when a piece of furniture was traced from a photo at its true size.
   */
  size?: { w: number; h: number; d: number };
  /** Photo region traced over this object's front face. */
  traceTexture?: Texture | null;
  /** A real product photo, background removed. Replaces the procedural model. */
  customTexture?: Texture | null;
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function Emissive({
  product,
  intensityScale = 1,
}: {
  product: Product;
  intensityScale?: number;
}) {
  const e = product.emissive;
  return (
    <meshStandardMaterial
      color={e?.color ?? product.palette[0]}
      emissive={e?.color ?? product.palette[0]}
      emissiveIntensity={(e?.intensity ?? 1) * intensityScale}
      roughness={0.35}
      metalness={0}
      toneMapped={false}
    />
  );
}

/** A point light matching a product's emissive spec, if the scene allows one. */
function ProductLight({
  product,
  enabled,
  position = [0, 0, 0],
  scale = 1,
}: {
  product: Product;
  enabled?: boolean;
  position?: Vec3;
  scale?: number;
}) {
  const e = product.emissive;
  if (!enabled || !e || e.lightIntensity <= 0) return null;
  return (
    <pointLight
      position={position}
      color={e.color}
      intensity={e.lightIntensity * scale}
      distance={e.distance}
      decay={2}
    />
  );
}

/**
 * The halo an emissive object throws onto the surface behind it.
 *
 * Additively blended, depth-write off, sitting a few millimetres proud of the
 * wall. This is the detail that makes a neon sign look mounted rather than
 * pasted: real neon lights up the wall around it, and without that spill the
 * eye reads the tube as a sticker no matter how bright it is.
 */
function WallGlow({
  colour,
  width,
  height,
  z = 0.004,
  spread = 2.3,
  opacity = 0.5,
}: {
  colour: string;
  width: number;
  height: number;
  z?: number;
  spread?: number;
  opacity?: number;
}) {
  const tex = React.useMemo(() => glowTexture(2.4), []);
  return (
    <mesh position={[0, 0, z]} renderOrder={-1}>
      <planeGeometry args={[width * spread, height * spread]} />
      <meshBasicMaterial
        map={tex}
        color={colour}
        transparent
        opacity={opacity}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * A spotlight that actually projects a pattern.
 *
 * three.js projects `SpotLight.map` through the light's shadow camera, so the
 * map only lands on geometry when `castShadow` is on — hence the shadow map
 * here despite nothing needing to cast a shadow. The target has to be a real
 * object in the scene graph too: a SpotLight with no target aims at the world
 * origin, which for a lamp standing against a wall means pointing at the
 * middle of the room.
 */
function ProjectorLight({
  colour,
  intensity,
  distance,
  pattern,
  angle = 0.62,
  position = [0, 0, 0],
  target = [0, 1.2, -3],
}: {
  colour: string;
  intensity: number;
  distance: number;
  pattern: "sunset" | "galaxy" | "wash";
  angle?: number;
  position?: Vec3;
  target?: Vec3;
}) {
  const light = React.useRef<ThreeSpotLight>(null);
  const anchor = React.useRef<Object3D>(null);
  const map = React.useMemo(() => projectionTexture(pattern), [pattern]);

  React.useLayoutEffect(() => {
    if (light.current && anchor.current) light.current.target = anchor.current;
  }, []);

  return (
    <>
      <spotLight
        ref={light}
        position={position}
        color={colour}
        intensity={intensity}
        distance={distance}
        angle={angle}
        penumbra={0.85}
        decay={1.4}
        map={map}
        castShadow
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
        shadow-bias={-0.002}
      />
      <object3D ref={anchor} position={target} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Wall-mounted                                                        */
/* ------------------------------------------------------------------ */

function Poster({ product }: ModelProps) {
  const tex = React.useMemo(() => artworkTexture(product), [product]);
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);

  return (
    <group>
      {/* Backing gives the print a real edge instead of a zero-thickness card */}
      <mesh position={[0, 0, d / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, Math.max(d, 0.0015)]} />
        <meshStandardMaterial color="#0e0e10" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0, d + 0.0006]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={tex} roughness={0.78} metalness={0} />
      </mesh>
    </group>
  );
}

function FramedArt({ product }: ModelProps) {
  const tex = React.useMemo(() => artworkTexture(product), [product]);
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const b = Math.min(w, h) * 0.055; // frame border
  const frameColour = product.palette[0];

  return (
    <group>
      <mesh position={[0, 0, d / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#121214" roughness={0.9} />
      </mesh>

      {/* Four border rails rather than a hollowed box — cheaper and sharper */}
      {(
        [
          [0, h / 2 - b / 2, w, b],
          [0, -h / 2 + b / 2, w, b],
          [-w / 2 + b / 2, 0, b, h - b * 2],
          [w / 2 - b / 2, 0, b, h - b * 2],
        ] as [number, number, number, number][]
      ).map(([x, y, rw, rh], i) => (
        <mesh key={i} position={[x, y, d + 0.004]} castShadow>
          <boxGeometry args={[rw, rh, 0.012]} />
          <meshStandardMaterial color={frameColour} roughness={0.42} metalness={0.25} />
        </mesh>
      ))}

      <mesh position={[0, 0, d + 0.0015]}>
        <planeGeometry args={[w - b * 2, h - b * 2]} />
        <meshStandardMaterial map={tex} roughness={0.5} metalness={0.02} />
      </mesh>
    </group>
  );
}

function Tapestry({ product }: ModelProps) {
  const tex = React.useMemo(() => artworkTexture(product), [product]);
  const w = M(product.dims.w);
  const h = M(product.dims.h);

  // Cloth hangs from its top edge, so the sag grows toward the bottom and the
  // whole sheet bows slightly off the wall.
  const geom = React.useMemo(() => {
    const segs = 18;
    return { segs, w, h };
  }, [w, h]);

  const ref = React.useRef<import("three").Mesh | null>(null);
  React.useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const fromTop = (h / 2 - y) / h;
      const across = Math.cos((x / w) * Math.PI);
      pos.setZ(i, fromTop * across * h * 0.035 + fromTop * 0.012);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }, [w, h]);

  return (
    <mesh ref={ref} position={[0, 0, 0.012]} castShadow receiveShadow>
      <planeGeometry args={[geom.w, geom.h, geom.segs, geom.segs]} />
      <meshStandardMaterial map={tex} roughness={0.95} side={DoubleSide} />
    </mesh>
  );
}

function PhotoGrid({ product }: ModelProps) {
  const tex = React.useMemo(() => photoGridTexture(product), [product]);
  return (
    <mesh position={[0, 0, 0.003]}>
      <planeGeometry args={[M(product.dims.w), M(product.dims.h)]} />
      <meshStandardMaterial map={tex} transparent roughness={0.85} alphaTest={0.4} />
    </mesh>
  );
}

function NeonSign({ product, light, lightScale = 1 }: ModelProps) {
  const curve = React.useMemo(() => neonCurve(product), [product]);
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const tubeR = Math.min(w, h) * 0.03;
  const colour = product.emissive?.color ?? product.palette[0];

  return (
    <group>
      {/* Light thrown onto the wall behind. Deliberately NOT a backplate: a
          dark panel occludes the wall instead of lighting it, which is exactly
          what makes a sign read as a floating rectangle. */}
      <WallGlow colour={colour} width={w} height={h} spread={2.4} opacity={0.55} />

      {/* Clear acrylic the tube is actually mounted on — visible only as a
          faint edge, the way real acrylic is. */}
      <mesh position={[0, 0, 0.008]}>
        <boxGeometry args={[w, h, 0.005]} />
        <meshPhysicalMaterial
          color="#ffffff"
          roughness={0.05}
          metalness={0}
          transmission={0.96}
          thickness={0.004}
          ior={1.49}
          transparent
          opacity={0.18}
          depthWrite={false}
        />
      </mesh>

      {/* Standoff pins, so it sits off the wall like the real thing */}
      {([-1, 1] as const).map((sx) =>
        ([-1, 1] as const).map((sy) => (
          <mesh
            key={`${sx}${sy}`}
            position={[sx * (w / 2 - 0.02), sy * (h / 2 - 0.02), 0.005]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[0.004, 0.004, 0.011, 8]} />
            <meshStandardMaterial color="#c8ccd2" roughness={0.25} metalness={0.9} />
          </mesh>
        )),
      )}

      {/* Outer bloom shell, then the hot core. Two passes read as glass with
          gas inside it; one pass reads as a coloured wire. */}
      <mesh position={[0, 0, 0.022]}>
        <tubeGeometry args={[curve, 110, tubeR * 2.6, 6, false]} />
        <meshBasicMaterial
          color={colour}
          transparent
          opacity={0.16}
          blending={AdditiveBlending}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0, 0.022]}>
        <tubeGeometry args={[curve, 150, tubeR, 10, false]} />
        <meshBasicMaterial color={colour} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.022]}>
        <tubeGeometry args={[curve, 150, tubeR * 0.45, 8, false]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} opacity={0.85} transparent />
      </mesh>

      <ProductLight product={product} enabled={light} scale={lightScale} position={[0, 0, 0.18]} />
    </group>
  );
}

function WallClock({ product }: ModelProps) {
  const r = M(product.dims.w) / 2;
  const d = M(product.dims.d);
  const [body, face] = product.palette;

  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <mesh position={[0, d / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, d, 40]} />
        <meshStandardMaterial color={body} roughness={0.45} metalness={0.15} />
      </mesh>
      <mesh position={[0, d + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[r * 0.9, 40]} />
        <meshStandardMaterial color={face} roughness={0.3} />
      </mesh>
      {/* Hour ticks at 12/3/6/9 only — matches the "minimal" product it is */}
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          position={[
            Math.cos((i * Math.PI) / 2) * r * 0.74,
            d + 0.002,
            Math.sin((i * Math.PI) / 2) * r * 0.74,
          ]}
          rotation={[-Math.PI / 2, 0, -(i * Math.PI) / 2]}
        >
          <planeGeometry args={[r * 0.11, r * 0.028]} />
          <meshStandardMaterial color={body} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, d + 0.003, -r * 0.26]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[r * 0.035, r * 0.52]} />
        <meshStandardMaterial color={body} roughness={0.4} />
      </mesh>
      <mesh position={[r * 0.18, d + 0.003, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
        <planeGeometry args={[r * 0.03, r * 0.36]} />
        <meshStandardMaterial color={body} roughness={0.4} />
      </mesh>
    </group>
  );
}

function Mirror({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [frame, glass] = product.palette;
  const round = Math.abs(w - h) < Math.min(w, h) * 0.12;

  // An arched mirror is a rectangle capped with a semicircle; building it as a
  // Shape keeps the silhouette right instead of approximating with a box.
  const archShape = React.useMemo(() => {
    if (round) return null;
    const s = new Shape();
    const r = w / 2;
    const straight = h - r;
    s.moveTo(-r, -h / 2);
    s.lineTo(-r, -h / 2 + straight);
    s.absarc(0, -h / 2 + straight, r, Math.PI, 0, true);
    s.lineTo(r, -h / 2);
    s.closePath();
    return s;
  }, [round, w, h]);

  const mirrorMat = (
    <meshStandardMaterial
      color={glass}
      roughness={0.03}
      metalness={1}
      envMapIntensity={2.4}
    />
  );

  if (round) {
    const r = w / 2;
    return (
      <group>
        <mesh position={[0, 0, d / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[r, r, d, 48]} />
          <meshStandardMaterial color={frame} roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position={[0, 0, d + 0.001]}>
          <circleGeometry args={[r * 0.93, 48]} />
          {mirrorMat}
        </mesh>
      </group>
    );
  }

  return (
    <group>
      <mesh position={[0, 0, d / 2]} castShadow receiveShadow>
        <extrudeGeometry args={[archShape!, { depth: d, bevelEnabled: false }]} />
        <meshStandardMaterial color={frame} roughness={0.45} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0, d + 0.001]} scale={[0.93, 0.95, 1]}>
        <extrudeGeometry args={[archShape!, { depth: 0.002, bevelEnabled: false }]} />
        {mirrorMat}
      </mesh>
    </group>
  );
}

function Shelf({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [top, bracket] = product.palette;

  // Wall-mounted: origin is on the wall, board extends outward along +z.
  // Its top face at y = +h/2 is what stackSurface() reports, so figures placed
  // on it land exactly on the board.
  return (
    <group>
      <mesh position={[0, 0, d / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={top} roughness={0.62} metalness={0.05} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * (w / 2 - w * 0.12), -h * 0.9, d * 0.34]}
          castShadow
        >
          <boxGeometry args={[h * 0.5, h * 1.6, d * 0.62]} />
          <meshStandardMaterial color={bracket ?? top} roughness={0.5} metalness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Lighting                                                            */
/* ------------------------------------------------------------------ */

function DeskLamp({ product, light, lightScale = 1 }: ModelProps) {
  const h = M(product.dims.h);
  const reach = M(product.dims.d);
  const [body, accent] = product.palette;
  const mat = (
    <meshStandardMaterial color={body} roughness={0.32} metalness={0.55} />
  );

  return (
    <group>
      <mesh position={[0, h * 0.012, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[M(product.dims.w) / 2, M(product.dims.w) / 2, h * 0.025, 28]} />
        {mat}
      </mesh>
      <mesh position={[0, h * 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.008, 0.009, h * 0.95, 14]} />
        {mat}
      </mesh>
      {/* Horizontal arm reaching over the desk */}
      <mesh position={[0, h * 0.97, reach * 0.3]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.008, 0.008, reach * 0.62, 14]} />
        {mat}
      </mesh>
      <group position={[0, h * 0.955, reach * 0.6]}>
        <mesh rotation={[Math.PI, 0, 0]} castShadow>
          <coneGeometry args={[M(product.dims.w) * 0.42, h * 0.14, 24, 1, true]} />
          <meshStandardMaterial
            color={body}
            roughness={0.3}
            metalness={0.5}
            side={DoubleSide}
          />
        </mesh>
        <mesh position={[0, -h * 0.055, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[M(product.dims.w) * 0.33, 24]} />
          <meshStandardMaterial
            color={accent ?? "#fff2d8"}
            emissive={product.emissive?.color ?? "#fff2d8"}
            emissiveIntensity={product.emissive?.intensity ?? 1.4}
            toneMapped={false}
          />
        </mesh>
        {light && product.emissive ? (
          <spotLight
            position={[0, -0.02, 0]}
            target-position={[0, -1, 0]}
            angle={0.85}
            penumbra={0.8}
            color={product.emissive.color}
            intensity={product.emissive.lightIntensity * lightScale}
            distance={product.emissive.distance}
            decay={2}
            castShadow
          />
        ) : null}
      </group>
    </group>
  );
}

function MoonLamp({ product, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const r = w / 2;
  const standH = h - w;

  return (
    <group>
      {standH > 0.004 && (
        <mesh position={[0, standH / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[r * 0.42, r * 0.55, standH, 20]} />
          <meshStandardMaterial color={product.palette[1] ?? "#2a2620"} roughness={0.5} />
        </mesh>
      )}
      <mesh position={[0, standH + r, 0]} castShadow>
        <icosahedronGeometry args={[r, 3]} />
        <Emissive product={product} />
      </mesh>
      <ProductLight product={product} enabled={light} scale={lightScale} position={[0, standH + r, 0]} />
    </group>
  );
}

function SunsetLamp({ product, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const r = w / 2;
  const colour = product.emissive?.color ?? product.palette[0];
  const pattern = product.tags.includes("galaxy") ? "galaxy" : "sunset";

  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r * 1.04, h, 32]} />
        <meshStandardMaterial
          color={product.palette[1] ?? "#1a1a1e"}
          roughness={0.32}
          metalness={0.45}
        />
      </mesh>

      {/* Lens, tilted up — this is where the beam leaves the lamp */}
      <group position={[0, h * 0.78, r * 0.55]} rotation={[-0.55, 0, 0]}>
        <mesh>
          <circleGeometry args={[r * 0.62, 32]} />
          <meshBasicMaterial color={colour} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, 0.002]}>
          <circleGeometry args={[r * 1.5, 32]} />
          <meshBasicMaterial
            map={glowTexture(2.6)}
            color={colour}
            transparent
            opacity={0.55}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* The projection itself, thrown up and forward onto whatever is there */}
      {light && product.emissive ? (
        <ProjectorLight
          colour={colour}
          intensity={product.emissive.lightIntensity * lightScale * 2.4}
          distance={product.emissive.distance * 2.2}
          pattern={pattern}
          angle={0.55}
          position={[0, h * 0.78, r * 0.55]}
          target={[0, h + 1.6, -2.4]}
        />
      ) : null}
    </group>
  );
}

function BarLamp({ product, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const tall = h > w;
  const [body] = product.palette;

  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={body} roughness={0.38} metalness={0.4} />
      </mesh>
      {/* Emissive face: down-facing for a monitor bar, front-facing for a tower */}
      {tall ? (
        <mesh position={[0, h / 2, d / 2 + 0.001]}>
          <planeGeometry args={[w * 0.6, h * 0.88]} />
          <Emissive product={product} />
        </mesh>
      ) : (
        <mesh position={[0, 0.001, d * 0.1]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[w * 0.92, d * 0.5]} />
          <Emissive product={product} />
        </mesh>
      )}
      <ProductLight
        product={product}
        enabled={light}
        scale={lightScale}
        position={tall ? [0, h * 0.6, d] : [0, -0.01, d * 0.4]}
      />
    </group>
  );
}

function LedStrip({ product, path, light, lightScale = 1 }: ModelProps) {
  const thickness = M(product.dims.h);
  if (!path) return null;

  const a = new Vector3(...path[0]);
  const b = new Vector3(...path[1]);
  const length = a.distanceTo(b);
  const mid = a.clone().lerp(b, 0.5);
  const dir = b.clone().sub(a).normalize();

  // The parent renders edge items in world space, so this group positions
  // itself rather than inheriting a mount transform.
  const quaternionTarget = new Vector3(1, 0, 0);
  const axis = quaternionTarget.clone().cross(dir);
  const angle = Math.acos(Math.min(1, Math.max(-1, quaternionTarget.dot(dir))));

  return (
    <group
      position={[mid.x, mid.y, mid.z]}
      quaternion={
        axis.lengthSq() < 1e-8
          ? [0, 0, 0, 1]
          : (() => {
              const n = axis.normalize();
              const s = Math.sin(angle / 2);
              return [n.x * s, n.y * s, n.z * s, Math.cos(angle / 2)] as [
                number,
                number,
                number,
                number,
              ];
            })()
      }
    >
      <mesh>
        <boxGeometry args={[length, thickness, thickness * 0.8]} />
        <Emissive product={product} />
      </mesh>
      {/* Bloom needs something wider than a 12mm strip to bite on */}
      <mesh>
        <boxGeometry args={[length, thickness * 3, thickness * 3]} />
        <meshBasicMaterial
          color={product.emissive?.color ?? product.palette[0]}
          transparent
          opacity={0.1}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      {light && product.emissive
        ? [-0.32, 0, 0.32].map((t) => (
            <pointLight
              key={t}
              position={[length * t, 0, 0]}
              color={product.emissive!.color}
              intensity={product.emissive!.lightIntensity * lightScale * 0.5}
              distance={product.emissive!.distance}
              decay={2}
            />
          ))
        : null}
    </group>
  );
}

function StringLights({ product, path, light, lightScale = 1 }: ModelProps) {
  const points = React.useMemo(() => {
    if (!path) return [];
    const a = new Vector3(...path[0]);
    const b = new Vector3(...path[1]);
    return catenary(a, b, Math.min(0.14, a.distanceTo(b) * 0.06), 28);
  }, [path]);

  if (!path || points.length === 0) return null;
  const colour = product.emissive?.color ?? product.palette[0];

  return (
    <group>
      {points.slice(0, -1).map((p, i) => {
        const q = points[i + 1];
        const mid = p.clone().lerp(q, 0.5);
        const len = p.distanceTo(q);
        const dir = q.clone().sub(p).normalize();
        const angleY = Math.atan2(dir.x, dir.z);
        const angleX = Math.asin(-dir.y);
        return (
          <mesh
            key={i}
            position={[mid.x, mid.y, mid.z]}
            rotation={[angleX + Math.PI / 2, angleY, 0]}
          >
            <cylinderGeometry args={[0.0016, 0.0016, len, 5]} />
            <meshStandardMaterial color="#4a4239" roughness={0.85} />
          </mesh>
        );
      })}

      {points
        .filter((_, i) => i % 3 === 1)
        .map((p, i) => (
          <mesh key={`b${i}`} position={[p.x, p.y - 0.012, p.z]}>
            <sphereGeometry args={[0.009, 8, 8]} />
            <Emissive product={product} />
          </mesh>
        ))}

      {light && product.emissive
        ? [0.25, 0.75].map((t) => {
            const p = points[Math.floor(points.length * t)];
            return (
              <pointLight
                key={t}
                position={[p.x, p.y, p.z]}
                color={colour}
                intensity={product.emissive!.lightIntensity * lightScale * 0.5}
                distance={product.emissive!.distance}
                decay={2}
              />
            );
          })
        : null}
    </group>
  );
}

function DiscoBall({ product }: ModelProps) {
  const r = M(product.dims.w) / 2;
  const cord = M(product.dims.h) * 0.3;
  return (
    <group>
      <mesh position={[0, -cord / 2, 0]}>
        <cylinderGeometry args={[0.0015, 0.0015, cord, 6]} />
        <meshStandardMaterial color="#2a2a2e" roughness={0.8} />
      </mesh>
      <mesh position={[0, -cord - r, 0]} castShadow>
        {/* Low subdivision on purpose: the visible facets are the whole point */}
        <icosahedronGeometry args={[r, 1]} />
        <meshStandardMaterial
          color={product.palette[0]}
          roughness={0.06}
          metalness={1}
          flatShading
          envMapIntensity={2.6}
        />
      </mesh>
    </group>
  );
}

function Candle({ product, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const r = w / 2;
  const jar = product.tags.includes("jar");
  const [wax, glass] = product.palette;

  return (
    <group>
      {jar ? (
        <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[r, r * 0.94, h, 28, 1, true]} />
          <meshPhysicalMaterial
            color={glass ?? "#c9a06a"}
            roughness={0.08}
            transmission={0.82}
            thickness={0.01}
            transparent
            opacity={0.65}
            side={DoubleSide}
          />
        </mesh>
      ) : null}

      <mesh position={[0, h * 0.42, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r * 0.88, r * 0.88, h * (jar ? 0.7 : 0.94), 24]} />
        <meshStandardMaterial color={wax} roughness={0.72} />
      </mesh>

      <mesh position={[0, h * (jar ? 0.82 : 1.0), 0]}>
        <coneGeometry args={[r * 0.16, h * 0.1, 10]} />
        <Emissive product={product} intensityScale={1.6} />
      </mesh>
      <ProductLight product={product} enabled={light} scale={lightScale} position={[0, h * 0.9, 0]} />
    </group>
  );
}

function Diffuser({ product, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const r = w / 2;
  const reeds = product.tags.includes("reed");
  const rnd = seededRandom(product.id);

  return (
    <group>
      <mesh position={[0, h * (reeds ? 0.22 : 0.45), 0]} castShadow receiveShadow>
        {reeds ? (
          <sphereGeometry args={[r, 20, 16]} />
        ) : (
          <cylinderGeometry args={[r * 0.82, r, h * 0.9, 28]} />
        )}
        <meshStandardMaterial color={product.palette[0]} roughness={0.35} metalness={0.1} />
      </mesh>

      {reeds
        ? Array.from({ length: 7 }).map((_, i) => (
            <mesh
              key={i}
              position={[(rnd() - 0.5) * r * 0.4, h * 0.62, (rnd() - 0.5) * r * 0.4]}
              rotation={[(rnd() - 0.5) * 0.35, 0, (rnd() - 0.5) * 0.35]}
            >
              <cylinderGeometry args={[0.0012, 0.0012, h * 0.8, 5]} />
              <meshStandardMaterial color={product.palette[1] ?? "#c9a06a"} roughness={0.9} />
            </mesh>
          ))
        : (
            <mesh position={[0, h * 0.9, 0]}>
              <cylinderGeometry args={[r * 0.5, r * 0.5, h * 0.04, 24]} />
              <Emissive product={product} />
            </mesh>
          )}

      <ProductLight product={product} enabled={light} scale={lightScale} position={[0, h, 0]} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Plants & vessels                                                    */
/* ------------------------------------------------------------------ */

function Leaves({
  count,
  radius,
  height,
  colour,
  notched,
  seed,
}: {
  count: number;
  radius: number;
  height: number;
  colour: string;
  notched: boolean;
  seed: string;
}) {
  const shape = React.useMemo(() => leafShape(notched), [notched]);
  const rnd = React.useMemo(() => seededRandom(seed), [seed]);

  const leaves = React.useMemo(
    () =>
      Array.from({ length: count }).map(() => ({
        angle: rnd() * Math.PI * 2,
        tilt: 0.25 + rnd() * 0.8,
        size: radius * (0.55 + rnd() * 0.55),
        lift: height * (0.25 + rnd() * 0.7),
        spin: (rnd() - 0.5) * 0.6,
      })),
    [count, radius, height, rnd],
  );

  return (
    <>
      {leaves.map((l, i) => (
        <group key={i} position={[0, l.lift, 0]} rotation={[0, l.angle, 0]}>
          <group rotation={[l.tilt, 0, l.spin]}>
            {/* Stem */}
            <mesh position={[0, l.size * 0.28, 0]} rotation={[0, 0, 0]}>
              <cylinderGeometry args={[0.0025, 0.003, l.size * 0.56, 5]} />
              <meshStandardMaterial color="#3c5c3a" roughness={0.85} />
            </mesh>
            <mesh
              position={[0, l.size * 0.5, 0]}
              scale={[l.size, l.size, l.size]}
              castShadow
            >
              <shapeGeometry args={[shape]} />
              <meshStandardMaterial
                color={colour}
                roughness={0.66}
                side={DoubleSide}
              />
            </mesh>
          </group>
        </group>
      ))}
    </>
  );
}

function Plant({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const potH = h * (h > 0.4 ? 0.28 : 0.45);
  const potR = Math.min(w / 2, potH * 0.85);
  const [leaf, pot] = product.palette;
  const big = h > 0.35;

  return (
    <group>
      <mesh position={[0, potH / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[potR, potR * 0.78, potH, 26]} />
        <meshStandardMaterial color={pot ?? "#2a2724"} roughness={0.78} />
      </mesh>
      <mesh position={[0, potH - 0.004, 0]}>
        <cylinderGeometry args={[potR * 0.94, potR * 0.94, 0.008, 22]} />
        <meshStandardMaterial color="#221a14" roughness={1} />
      </mesh>
      <group position={[0, potH, 0]}>
        <Leaves
          count={big ? 9 : 6}
          radius={big ? w * 0.42 : w * 0.55}
          height={h - potH}
          colour={leaf}
          notched={big}
          seed={product.id}
        />
      </group>
    </group>
  );
}

function HangingPlant({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const cord = h * 0.42;
  const potR = w / 2;
  const potH = w * 0.55;
  const [leaf, rope] = product.palette;

  // Origin is the ceiling attachment, so everything hangs into -y.
  return (
    <group>
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * potR * 0.3, -cord / 2, Math.sin(a) * potR * 0.3]}
            rotation={[0, 0, Math.cos(a) * 0.08]}
          >
            <cylinderGeometry args={[0.0018, 0.0018, cord, 5]} />
            <meshStandardMaterial color={rope ?? "#8a7a5a"} roughness={0.95} />
          </mesh>
        );
      })}
      <mesh position={[0, -cord - potH / 2, 0]} castShadow>
        <cylinderGeometry args={[potR, potR * 0.8, potH, 22]} />
        <meshStandardMaterial color={rope ?? "#8a7a5a"} roughness={0.82} />
      </mesh>
      <group position={[0, -cord - potH * 0.1, 0]}>
        <Leaves
          count={8}
          radius={w * 0.5}
          height={-(h - cord - potH) * 0.8}
          colour={leaf}
          notched={false}
          seed={product.id}
        />
      </group>
    </group>
  );
}

function Vase({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const pampas = product.tags.includes("pampas");
  const vaseH = pampas ? h * 0.42 : h;
  const r = w / 2;
  const rnd = React.useMemo(() => seededRandom(product.id), [product.id]);

  const profile = React.useMemo(() => {
    // Lathe profile: narrow foot, belly, tapered neck — a recognisable vase
    // silhouette from six points.
    const pts: [number, number][] = [
      [r * 0.42, 0],
      [r * 0.66, vaseH * 0.08],
      [r * 1.0, vaseH * 0.36],
      [r * 0.86, vaseH * 0.72],
      [r * 0.62, vaseH * 0.95],
      [r * 0.6, vaseH],
    ];
    return pts.map(([x, y]) => new Vector2(x, y));
  }, [r, vaseH]);

  return (
    <group>
      <mesh castShadow receiveShadow>
        <latheGeometry args={[profile, 32]} />
        <meshStandardMaterial
          color={product.palette[0]}
          roughness={0.55}
          metalness={0.06}
          side={DoubleSide}
        />
      </mesh>

      {pampas
        ? Array.from({ length: 11 }).map((_, i) => {
            const lean = (rnd() - 0.5) * 0.34;
            const a = rnd() * Math.PI * 2;
            const len = (h - vaseH) * (0.7 + rnd() * 0.5);
            return (
              <group key={i} position={[0, vaseH * 0.94, 0]} rotation={[lean, a, lean]}>
                <mesh position={[0, len / 2, 0]}>
                  <cylinderGeometry args={[0.0016, 0.002, len, 5]} />
                  <meshStandardMaterial color="#b9a882" roughness={0.95} />
                </mesh>
                <mesh position={[0, len * 0.86, 0]} castShadow>
                  <capsuleGeometry args={[len * 0.055, len * 0.3, 3, 7]} />
                  <meshStandardMaterial color={product.palette[0]} roughness={1} />
                </mesh>
              </group>
            );
          })
        : null}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Collectibles                                                        */
/* ------------------------------------------------------------------ */

function Figure({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const [hair, outfit, skin] = product.palette;

  const baseH = h * 0.035;
  const legH = h * 0.33;
  const torsoH = h * 0.3;
  const headR = h * 0.105;

  return (
    <group>
      <mesh position={[0, baseH / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[w * 0.38, w * 0.4, baseH, 26]} />
        <meshStandardMaterial color="#141416" roughness={0.35} metalness={0.2} />
      </mesh>

      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * w * 0.1, baseH + legH / 2, 0]}
          rotation={[0, 0, s * 0.04]}
          castShadow
        >
          <capsuleGeometry args={[w * 0.075, legH * 0.66, 4, 10]} />
          <meshStandardMaterial color={skin ?? "#f2e6d8"} roughness={0.62} />
        </mesh>
      ))}

      <mesh position={[0, baseH + legH + torsoH / 2, 0]} castShadow>
        <capsuleGeometry args={[w * 0.2, torsoH * 0.6, 5, 14]} />
        <meshStandardMaterial color={outfit ?? "#3a2a4a"} roughness={0.68} />
      </mesh>

      {/* Flared skirt/coat — the silhouette cue that reads as a posed figure */}
      <mesh position={[0, baseH + legH + torsoH * 0.12, 0]} castShadow>
        <coneGeometry args={[w * 0.4, torsoH * 0.62, 18, 1, true]} />
        <meshStandardMaterial color={outfit ?? "#3a2a4a"} roughness={0.7} side={DoubleSide} />
      </mesh>

      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * w * 0.24, baseH + legH + torsoH * 0.62, 0]}
          rotation={[0, 0, s * 0.55]}
          castShadow
        >
          <capsuleGeometry args={[w * 0.055, torsoH * 0.5, 4, 8]} />
          <meshStandardMaterial color={skin ?? "#f2e6d8"} roughness={0.62} />
        </mesh>
      ))}

      <mesh position={[0, baseH + legH + torsoH + headR * 0.82, 0]} castShadow>
        <sphereGeometry args={[headR, 20, 16]} />
        <meshStandardMaterial color={skin ?? "#f2e6d8"} roughness={0.58} />
      </mesh>
      <mesh
        position={[0, baseH + legH + torsoH + headR * 0.95, -headR * 0.12]}
        scale={[1.12, 1.2, 1.16]}
        castShadow
      >
        <sphereGeometry args={[headR, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
        <meshStandardMaterial color={hair} roughness={0.5} side={DoubleSide} />
      </mesh>
    </group>
  );
}

function Funko({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const [body, accent, skin] = product.palette;
  const headR = h * 0.3;
  const bodyH = h * 0.36;

  return (
    <group>
      <mesh position={[0, h * 0.015, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[w * 0.42, w * 0.44, h * 0.03, 20]} />
        <meshStandardMaterial color="#1a1a1c" roughness={0.5} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * w * 0.13, h * 0.09, 0]} castShadow>
          <boxGeometry args={[w * 0.18, h * 0.12, w * 0.24]} />
          <meshStandardMaterial color={accent ?? body} roughness={0.66} />
        </mesh>
      ))}
      <mesh position={[0, h * 0.03 + bodyH / 2 + h * 0.1, 0]} castShadow>
        <boxGeometry args={[w * 0.52, bodyH, w * 0.36]} />
        <meshStandardMaterial color={body} roughness={0.66} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * w * 0.33, h * 0.3, 0]} castShadow>
          <capsuleGeometry args={[w * 0.06, bodyH * 0.5, 3, 8]} />
          <meshStandardMaterial color={skin ?? "#e8d8c4"} roughness={0.66} />
        </mesh>
      ))}
      {/* Oversized head is the entire visual language of the format */}
      <mesh position={[0, h - headR * 0.95, 0]} castShadow>
        <boxGeometry args={[headR * 1.7, headR * 1.75, headR * 1.55]} />
        <meshStandardMaterial color={skin ?? "#e8d8c4"} roughness={0.6} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * headR * 0.4, h - headR * 0.85, headR * 0.79]}>
          <circleGeometry args={[headR * 0.17, 14]} />
          <meshStandardMaterial color="#14141a" roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function Bust({ product, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const [stone, accent] = product.palette;

  const profile = React.useMemo(() => {
    const r = w / 2;
    return [
      [r * 0.8, 0],
      [r * 0.86, h * 0.06],
      [r * 0.62, h * 0.12],
      [r * 0.78, h * 0.38],
      [r * 0.5, h * 0.58],
      [r * 0.3, h * 0.66],
    ].map(([x, y]) => new Vector2(x, y));
  }, [w, h]);

  return (
    <group>
      <mesh castShadow receiveShadow>
        <latheGeometry args={[profile, 26]} />
        <meshStandardMaterial color={stone} roughness={0.82} metalness={0.03} />
      </mesh>
      <mesh position={[0, h * 0.78, 0]} scale={[1, 1.2, 1.05]} castShadow>
        <icosahedronGeometry args={[w * 0.3, 2]} />
        <meshStandardMaterial color={stone} roughness={0.8} />
      </mesh>
      {product.emissive ? (
        <>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * w * 0.13, h * 0.82, w * 0.26]}>
              <capsuleGeometry args={[w * 0.022, w * 0.1, 3, 7]} />
              <Emissive product={product} />
            </mesh>
          ))}
          <ProductLight product={product} enabled={light} scale={lightScale} position={[0, h * 0.82, w * 0.4]} />
        </>
      ) : (
        <mesh position={[0, h * 0.68, 0]}>
          <torusGeometry args={[w * 0.26, w * 0.03, 8, 22]} />
          <meshStandardMaterial color={accent ?? stone} roughness={0.4} metalness={0.5} />
        </mesh>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Desk & setup                                                        */
/* ------------------------------------------------------------------ */

function Books({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const rnd = React.useMemo(() => seededRandom(product.id), [product.id]);
  const count = 3;
  const each = h / count;

  return (
    <group>
      {Array.from({ length: count }).map((_, i) => {
        const shrink = 1 - i * 0.07;
        return (
          <group
            key={i}
            position={[(rnd() - 0.5) * w * 0.08, each * (i + 0.5), (rnd() - 0.5) * d * 0.08]}
            rotation={[0, (rnd() - 0.5) * 0.18, 0]}
          >
            <mesh castShadow receiveShadow>
              <boxGeometry args={[w * shrink, each * 0.9, d * shrink]} />
              <meshStandardMaterial
                color={product.palette[i % product.palette.length]}
                roughness={0.78}
              />
            </mesh>
            {/* Page block inset on three sides */}
            <mesh position={[w * 0.012, 0, 0]}>
              <boxGeometry args={[w * shrink * 0.97, each * 0.78, d * shrink * 0.96]} />
              <meshStandardMaterial color="#e8e2d4" roughness={0.94} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Organizer({ product, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, accent] = product.palette;
  const round = product.tags.includes("pen") || product.tags.includes("concrete");
  const board = product.tags.includes("letter board") || product.tags.includes("memo");

  if (round) {
    return (
      <group>
        <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[w / 2, w / 2 * 0.92, h, 24, 1, true]} />
          <meshStandardMaterial color={body} roughness={0.88} side={DoubleSide} />
        </mesh>
        <mesh position={[0, h * 0.08, 0]}>
          <cylinderGeometry args={[w / 2 * 0.92, w / 2 * 0.92, h * 0.12, 20]} />
          <meshStandardMaterial color={body} roughness={0.9} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh
            key={i}
            position={[(i - 1.5) * w * 0.12, h * 1.25, (i % 2) * w * 0.08 - w * 0.04]}
            rotation={[(i - 1.5) * 0.06, 0, (i - 1.5) * 0.09]}
            castShadow
          >
            <cylinderGeometry args={[w * 0.035, w * 0.035, h * 1.35, 8]} />
            <meshStandardMaterial
              color={[accent, "#c9302c", "#2a5a8a", "#f2c14e"][i]}
              roughness={0.45}
            />
          </mesh>
        ))}
      </group>
    );
  }

  if (board) {
    return (
      <group>
        <mesh position={[0, h * 0.06, 0]} castShadow receiveShadow>
          <boxGeometry args={[w * 0.9, h * 0.12, d]} />
          <meshStandardMaterial color={product.palette[1] ?? "#2a2724"} roughness={0.6} />
        </mesh>
        <mesh position={[0, h * 0.56, 0]} rotation={[-0.12, 0, 0]} castShadow>
          <boxGeometry args={[w, h * 0.9, d * 0.22]} />
          <meshStandardMaterial color={product.palette[1] ?? "#2a2724"} roughness={0.7} />
        </mesh>
        <mesh position={[0, h * 0.56, d * 0.14]} rotation={[-0.12, 0, 0]}>
          <planeGeometry args={[w * 0.9, h * 0.76]} />
          <Emissive product={product} />
        </mesh>
        <ProductLight product={product} enabled={light} scale={lightScale} position={[0, h * 0.6, d * 0.4]} />
      </group>
    );
  }

  return (
    <group>
      <mesh position={[0, h * 0.06, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h * 0.12, d]} />
        <meshStandardMaterial color={body} roughness={0.72} />
      </mesh>
      {/* Four walls, so the tray reads as open rather than as a solid block */}
      {(
        [
          [0, 0, d / 2 - 0.004, w, 0.008],
          [0, 0, -d / 2 + 0.004, w, 0.008],
        ] as [number, number, number, number, number][]
      ).map(([x, , z, bw, bd], i) => (
        <mesh key={i} position={[x, h / 2, z]} castShadow>
          <boxGeometry args={[bw, h, bd]} />
          <meshStandardMaterial color={body} roughness={0.72} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2 - 0.004), h / 2, 0]} castShadow>
          <boxGeometry args={[0.008, h, d]} />
          <meshStandardMaterial color={body} roughness={0.72} />
        </mesh>
      ))}
      <mesh position={[w * 0.08, h / 2, 0]} castShadow>
        <boxGeometry args={[0.006, h * 0.82, d * 0.94]} />
        <meshStandardMaterial color={accent ?? body} roughness={0.7} />
      </mesh>
    </group>
  );
}

function Speaker({ product, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, accent] = product.palette;
  const arcade = product.tags.includes("arcade");

  if (arcade) {
    return (
      <group>
        <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color={body} roughness={0.5} />
        </mesh>
        <mesh position={[0, h * 0.68, d / 2 + 0.001]} rotation={[-0.18, 0, 0]}>
          <planeGeometry args={[w * 0.74, h * 0.34]} />
          <Emissive product={product} />
        </mesh>
        <mesh position={[0, h * 0.33, d / 2 + 0.002]} rotation={[-0.9, 0, 0]}>
          <planeGeometry args={[w * 0.82, h * 0.16]} />
          <meshStandardMaterial color={accent ?? "#141416"} roughness={0.6} />
        </mesh>
        <ProductLight product={product} enabled={light} scale={lightScale} position={[0, h * 0.7, d]} />
      </group>
    );
  }

  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[w / 2, w / 2, h * 0.94, 30]} />
        <meshStandardMaterial color={body} roughness={0.92} />
      </mesh>
      <mesh position={[0, h * 0.97, 0]}>
        <cylinderGeometry args={[w / 2 * 0.96, w / 2 * 0.96, h * 0.06, 30]} />
        <meshStandardMaterial color={accent ?? "#8a8a92"} roughness={0.3} metalness={0.65} />
      </mesh>
      <mesh position={[0, h * 0.99, 0]}>
        <torusGeometry args={[w * 0.26, w * 0.02, 8, 26]} />
        <meshStandardMaterial color="#1a1a1e" roughness={0.5} />
      </mesh>
    </group>
  );
}

function HeadphoneStand({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [metal, dark] = product.palette;
  const katana = product.tags.includes("katana");

  if (katana) {
    return (
      <group>
        <mesh position={[0, h * 0.12, 0]} castShadow receiveShadow>
          <boxGeometry args={[w * 0.34, h * 0.24, d]} />
          <meshStandardMaterial color={metal} roughness={0.62} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * w * 0.3, h * 0.55, 0]} castShadow>
            <boxGeometry args={[w * 0.06, h * 0.62, d * 0.5]} />
            <meshStandardMaterial color={metal} roughness={0.62} />
          </mesh>
        ))}
        <group position={[0, h * 0.82, 0]} rotation={[0, 0, 0.04]}>
          <mesh castShadow>
            <cylinderGeometry args={[h * 0.035, h * 0.035, w * 0.94, 10]} />
            <meshStandardMaterial color="#c8ccd2" roughness={0.16} metalness={0.95} />
          </mesh>
          <mesh position={[-w * 0.36, 0, 0]} castShadow>
            <cylinderGeometry args={[h * 0.042, h * 0.042, w * 0.24, 10]} />
            <meshStandardMaterial color={dark ?? "#141414"} roughness={0.8} />
          </mesh>
        </group>
      </group>
    );
  }

  return (
    <group>
      <mesh position={[0, h * 0.012, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[w / 2, w / 2, h * 0.025, 26]} />
        <meshStandardMaterial color={metal} roughness={0.3} metalness={0.8} />
      </mesh>
      <mesh position={[0, h * 0.5, 0]} castShadow>
        <cylinderGeometry args={[w * 0.07, w * 0.08, h * 0.95, 16]} />
        <meshStandardMaterial color={metal} roughness={0.3} metalness={0.8} />
      </mesh>
      {/* Yoke that the headband actually rests in */}
      <mesh position={[0, h * 0.96, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[w * 0.3, w * 0.05, 10, 24, Math.PI]} />
        <meshStandardMaterial color={dark ?? metal} roughness={0.55} metalness={0.3} />
      </mesh>
    </group>
  );
}

function Rug({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const tex = React.useMemo(
    () => weaveTexture(product.palette[0], product.palette[1] ?? product.palette[0], product.id),
    [product],
  );
  const round = Math.abs(w - d) < Math.min(w, d) * 0.08;

  return (
    <mesh position={[0, h / 2, 0]} receiveShadow>
      {round ? (
        <cylinderGeometry args={[w / 2, w / 2, h, 48]} />
      ) : (
        <boxGeometry args={[w, h, d]} />
      )}
      <meshStandardMaterial map={tex} color="#ffffff" roughness={0.98} metalness={0} />
    </mesh>
  );
}

function SideTable({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const [top, legs] = product.palette;
  const topH = h * 0.06;

  return (
    <group>
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * w * 0.36, (h - topH) / 2, Math.sin(a) * w * 0.36]}
            rotation={[Math.cos(a) * 0.07, 0, -Math.sin(a) * 0.07]}
            castShadow
          >
            <cylinderGeometry args={[w * 0.022, w * 0.03, h - topH, 10]} />
            <meshStandardMaterial color={legs ?? "#141416"} roughness={0.45} metalness={0.4} />
          </mesh>
        );
      })}
      <mesh position={[0, h - topH / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[w / 2, w / 2, topH, 40]} />
        <meshStandardMaterial color={top} roughness={0.6} metalness={0.04} />
      </mesh>
    </group>
  );
}

function BeanBag({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const tex = React.useMemo(
    () => weaveTexture(product.palette[0], product.palette[1] ?? product.palette[0], product.id),
    [product],
  );

  return (
    <group>
      <mesh position={[0, h * 0.38, 0]} scale={[1, 0.76, 1]} castShadow receiveShadow>
        <sphereGeometry args={[w / 2, 26, 20]} />
        <meshStandardMaterial map={tex} roughness={0.95} />
      </mesh>
      {/* Slumped backrest — a plain squashed sphere reads as a ball, not a seat */}
      <mesh
        position={[0, h * 0.66, -w * 0.16]}
        scale={[0.82, 0.62, 0.7]}
        rotation={[-0.3, 0, 0]}
        castShadow
      >
        <sphereGeometry args={[w / 2, 22, 16]} />
        <meshStandardMaterial map={tex} roughness={0.95} />
      </mesh>
    </group>
  );
}


/* ------------------------------------------------------------------ */
/* Gen-Z shelf pieces                                                  */
/* ------------------------------------------------------------------ */

/**
 * A cluster of drinks cans — the single most-photographed shelf object of the
 * moment. Modelled as real 330ml cans (66mm x 115mm) so a row of them reads at
 * the right size against a real shelf.
 */
function SodaCans({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const canH = h;
  const canR = M(3.3);
  const rnd = React.useMemo(() => seededRandom(product.id), [product.id]);

  const label = React.useMemo(
    () => canLabelTexture(product.palette[0], product.palette[1] ?? "#ffffff", product.id),
    [product],
  );

  const count = Math.max(1, Math.round(w / (canR * 2.25)));

  return (
    <group>
      {Array.from({ length: count }).map((_, i) => {
        const x = (i - (count - 1) / 2) * canR * 2.25;
        const z = (rnd() - 0.5) * canR * 0.7;
        return (
          <group key={i} position={[x, 0, z]} rotation={[0, rnd() * Math.PI * 2, 0]}>
            {/* Body takes the wrapper; the tapered ends stay bare aluminium */}
            <mesh position={[0, canH * 0.5, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[canR, canR, canH * 0.82, 22, 1, true]} />
              <meshStandardMaterial map={label} roughness={0.3} metalness={0.55} />
            </mesh>
            <mesh position={[0, canH * 0.93, 0]} castShadow>
              <cylinderGeometry args={[canR * 0.74, canR, canH * 0.16, 22]} />
              <meshStandardMaterial color="#c8ccd2" roughness={0.22} metalness={0.92} />
            </mesh>
            <mesh position={[0, canH * 0.06, 0]}>
              <cylinderGeometry args={[canR, canR * 0.8, canH * 0.12, 22]} />
              <meshStandardMaterial color="#b9bcc2" roughness={0.28} metalness={0.9} />
            </mesh>
            <mesh position={[0, canH * 1.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[canR * 0.74, 20]} />
              <meshStandardMaterial color="#d9dde3" roughness={0.2} metalness={0.95} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** The mushroom lamp — soft dome on a stem, and it genuinely lights the desk. */
function MushroomLamp({ product, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const r = w / 2;
  const colour = product.emissive?.color ?? product.palette[0];
  const [shade, base] = product.palette;

  return (
    <group>
      <mesh position={[0, h * 0.02, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r * 0.56, r * 0.62, h * 0.04, 28]} />
        <meshStandardMaterial color={base ?? shade} roughness={0.35} metalness={0.2} />
      </mesh>
      <mesh position={[0, h * 0.32, 0]} castShadow>
        <cylinderGeometry args={[r * 0.17, r * 0.22, h * 0.58, 20]} />
        <meshStandardMaterial color={base ?? shade} roughness={0.35} metalness={0.2} />
      </mesh>

      {/* Dome: a hemisphere, lit from inside */}
      <mesh position={[0, h * 0.62, 0]} castShadow>
        <sphereGeometry args={[r, 30, 18, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color={shade}
          emissive={colour}
          emissiveIntensity={product.emissive?.intensity ?? 1.6}
          roughness={0.42}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, h * 0.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[r * 0.94, 28]} />
        <meshBasicMaterial color={colour} toneMapped={false} />
      </mesh>

      {light && product.emissive ? (
        <pointLight
          position={[0, h * 0.55, 0]}
          color={colour}
          intensity={product.emissive.lightIntensity * lightScale}
          distance={product.emissive.distance}
          decay={2}
          castShadow
        />
      ) : null}
    </group>
  );
}

/** Cloud light — a puff of overlapping spheres that actually glows. */
function CloudLight({ product, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const colour = product.emissive?.color ?? product.palette[0];
  const rnd = React.useMemo(() => seededRandom(product.id), [product.id]);

  const puffs = React.useMemo(
    () =>
      Array.from({ length: 7 }).map((_, i) => ({
        x: (i / 6 - 0.5) * w * 0.78 + (rnd() - 0.5) * w * 0.08,
        y: (rnd() - 0.3) * h * 0.22,
        r: h * (0.3 + rnd() * 0.24),
      })),
    [w, h, rnd],
  );

  return (
    <group>
      <WallGlow colour={colour} width={w} height={h} spread={2.1} opacity={0.45} />
      {puffs.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, 0.02 + p.r * 0.5]}>
          <sphereGeometry args={[p.r, 18, 14]} />
          <meshStandardMaterial
            color="#f6f7fb"
            emissive={colour}
            emissiveIntensity={product.emissive?.intensity ?? 1.4}
            roughness={0.85}
            toneMapped={false}
          />
        </mesh>
      ))}
      <ProductLight product={product} enabled={light} scale={lightScale} position={[0, 0, 0.3]} />
    </group>
  );
}

/** Checkerboard mat or rug — flat, and unmistakably of its moment. */
function CheckerRug({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const tex = React.useMemo(
    () =>
      checkerTexture(
        product.palette[0],
        product.palette[1] ?? "#f2efe8",
        Math.max(4, Math.round(product.dims.w / 22)),
      ),
    [product],
  );
  const round = Math.abs(w - d) < Math.min(w, d) * 0.08;

  return (
    <mesh position={[0, h / 2, 0]} receiveShadow>
      {round ? (
        <cylinderGeometry args={[w / 2, w / 2, h, 48]} />
      ) : (
        <boxGeometry args={[w, h, d]} />
      )}
      <meshStandardMaterial map={tex} roughness={0.95} metalness={0} />
    </mesh>
  );
}

/**
 * A real product photo, mounted.
 *
 * Rendered at the product's true centimetres with its background cut away, so
 * what you see hanging on the wall is the item you are actually buying rather
 * than an interpretation of it. Emissive products additionally throw light onto
 * the wall and into the room, because a neon sign that does not light anything
 * reads as a printed poster of a neon sign.
 */
function CutoutPanel({ product, customTexture, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const emissive = product.emissive;
  const colour = emissive?.color ?? product.palette[0];
  if (!customTexture) return null;

  return (
    <group>
      {emissive ? (
        <WallGlow colour={colour} width={w} height={h} spread={2.2} opacity={0.5} />
      ) : null}

      <mesh position={[0, 0, 0.012]} castShadow={!emissive}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial
          map={customTexture}
          transparent
          alphaTest={0.35}
          side={DoubleSide}
          roughness={emissive ? 0.4 : 0.8}
          metalness={0}
          emissive={emissive ? colour : undefined}
          emissiveMap={emissive ? customTexture : undefined}
          emissiveIntensity={emissive ? emissive.intensity * 0.7 : 0}
          toneMapped={!emissive}
        />
      </mesh>

      {/* A slim backing board so the cutout has an edge when seen from an angle */}
      <mesh position={[0, 0, 0.006]}>
        <boxGeometry args={[w * 0.98, h * 0.98, 0.01]} />
        <meshStandardMaterial color="#17171a" roughness={0.9} transparent opacity={0.55} />
      </mesh>

      <ProductLight product={product} enabled={light} scale={lightScale} position={[0, 0, 0.18]} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

const REGISTRY: Record<string, React.ComponentType<ModelProps>> = {
  poster: Poster,
  framedArt: FramedArt,
  tapestry: Tapestry,
  photoGrid: PhotoGrid,
  neonSign: NeonSign,
  ledStrip: LedStrip,
  stringLights: StringLights,
  wallClock: WallClock,
  mirror: Mirror,
  shelf: Shelf,
  deskLamp: DeskLamp,
  moonLamp: MoonLamp,
  sunsetLamp: SunsetLamp,
  barLamp: BarLamp,
  discoBall: DiscoBall,
  plant: Plant,
  hangingPlant: HangingPlant,
  vase: Vase,
  candle: Candle,
  diffuser: Diffuser,
  figure: Figure,
  funko: Funko,
  bust: Bust,
  books: Books,
  organizer: Organizer,
  speaker: Speaker,
  headphoneStand: HeadphoneStand,
  rug: Rug,
  sideTable: SideTable,
  beanbag: BeanBag,
  sodaCans: SodaCans,
  mushroomLamp: MushroomLamp,
  cloudLight: CloudLight,
  checkerRug: CheckerRug,
};

export function ProductModel({ size, ...props }: ModelProps) {
  // A single override here saves every one of the thirty models below from
  // having to know that an instance can carry its own real-world size.
  const product = size ? { ...props.product, dims: size } : props.product;

  // A real photo beats any procedural stand-in, so it wins outright — but only
  // where a flat cutout is physically honest, which is wall decor.
  if (props.customTexture && product.mount === "wall") {
    return <CutoutPanel {...props} product={product} />;
  }

  const Component = REGISTRY[product.model] ?? FURNITURE_MODELS[product.model];
  if (!Component) {
    // A catalog entry with an unknown model kind still gets a correctly-sized
    // box rather than disappearing — placement stays testable.
    const { w, h, d } = product.dims;
    return (
      <mesh position={[0, M(h) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[M(w), M(h), M(d)]} />
        <meshStandardMaterial color={product.palette[0]} roughness={0.7} />
      </mesh>
    );
  }
  return <Component {...props} product={product} />;
}

export const EDGE_MOUNTED = new Set(["ledStrip", "stringLights"]);
