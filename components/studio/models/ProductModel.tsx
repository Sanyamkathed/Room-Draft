"use client";

import * as React from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferGeometry,
  TubeGeometry,
  BackSide,
  CanvasTexture,
  CatmullRomCurve3,
  CubeCamera,
  DoubleSide,
  HalfFloatType,
  IcosahedronGeometry,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Shape,
  SphereGeometry,
  Texture,
  Vector2,
  Vector3,
  WebGLCubeRenderTarget,
  type Group,
  type Mesh,
  type Object3D,
  type SpotLight as ThreeSpotLight,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBox } from "@react-three/drei";
import type { Product } from "@/lib/catalog/types";
import type { Vec3 } from "@/lib/room/types";
import {
  artworkTexture,
  canLabelTexture,
  checkerTexture,
  glowTexture,
  moonTexture,
  photoGridTexture,
  projectionTexture,
  weaveTexture,
} from "@/lib/three/textures";
import { FURNITURE_MODELS } from "./FurnitureModel";
import { bledCanvas, inflatedGeometry } from "@/lib/three/inflate";
import { FinishMaterial, MergedBoxes, Slab, useSeeded } from "./finish";
import { fitStrokes, neonStrokes } from "./neon";
import { M, catenary, leafShape, seededRandom } from "./shapes";

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
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const base = product.emissive?.color ?? product.palette[0];
  // Real LED neon flex is ~8-9mm across, whatever the size of the sign.
  const tubeR = 0.0045;

  const built = React.useMemo(() => {
    const { curves, width, height } = fitStrokes(neonStrokes(product), w, h);
    type Acc = {
      core: BufferGeometry[];
      shell: BufferGeometry[];
      inner: BufferGeometry[];
      min: Vector2;
      max: Vector2;
    };
    const groups = new Map<string, Acc>();
    for (const { curve, colour } of curves) {
      const c = colour ?? base;
      let g = groups.get(c);
      if (!g) {
        g = { core: [], shell: [], inner: [], min: new Vector2(Infinity, Infinity), max: new Vector2(-Infinity, -Infinity) };
        groups.set(c, g);
      }
      const segs = Math.max(12, Math.min(400, Math.round(curve.getLength() / 0.004)));
      g.core.push(new TubeGeometry(curve, segs, tubeR, 8, false));
      g.shell.push(new TubeGeometry(curve, segs, tubeR * 2.6, 6, false));
      g.inner.push(new TubeGeometry(curve, segs, tubeR * 0.45, 6, false));
      for (const p of curve.getPoints(24)) {
        g.min.min(new Vector2(p.x, p.y));
        g.max.max(new Vector2(p.x, p.y));
      }
    }
    // One mesh per colour and layer, however many letters share it.
    const merged = [...groups.entries()].map(([colour, g]) => {
      const out = {
        colour,
        core: mergeGeometries(g.core, false)!,
        shell: mergeGeometries(g.shell, false)!,
        inner: mergeGeometries(g.inner, false)!,
        centre: g.min.clone().add(g.max).multiplyScalar(0.5),
        size: g.max.clone().sub(g.min),
      };
      [...g.core, ...g.shell, ...g.inner].forEach((geo) => geo.dispose());
      return out;
    });
    return { groups: merged, width, height };
  }, [product, w, h, base]);

  React.useEffect(
    () => () => built.groups.forEach((g) => [g.core, g.shell, g.inner].forEach((geo) => geo.dispose())),
    [built],
  );

  // The acrylic is cut a little larger than the design, like the real thing.
  const plateW = Math.min(w, built.width + 0.04);
  const plateH = Math.min(h, built.height + 0.04);
  const tubeZ = 0.011 + tubeR;
  const glowOpacity = 0.5 / Math.sqrt(built.groups.length);

  return (
    <group>
      {/* Light thrown onto the wall behind, per colour. Real neon lights the
          wall around it; without that spill a sign reads as a sticker. */}
      {built.groups.map((g) => (
        <group key={`glow-${g.colour}`} position={[g.centre.x, g.centre.y, 0]}>
          <WallGlow
            colour={g.colour}
            width={Math.max(g.size.x, 0.06)}
            height={Math.max(g.size.y, 0.06)}
            spread={2.3}
            opacity={glowOpacity}
          />
        </group>
      ))}

      {/* Clear acrylic backing the tube is screwed to — seen only as a faint
          sheet and a bright edge, the way real acrylic is. */}
      <RoundedBox args={[plateW, plateH, 0.005]} radius={0.012} smoothness={3} position={[0, 0, 0.0065]}>
        <meshPhysicalMaterial
          color="#ffffff"
          roughness={0.04}
          metalness={0}
          clearcoat={1}
          transparent
          opacity={0.09}
          depthWrite={false}
        />
      </RoundedBox>

      {/* Standoff screws at the plate's corners */}
      {([-1, 1] as const).map((sx) =>
        ([-1, 1] as const).map((sy) => (
          <mesh
            key={`${sx}${sy}`}
            position={[sx * (plateW / 2 - 0.016), sy * (plateH / 2 - 0.016), 0.006]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[0.0045, 0.0045, 0.012, 10]} />
            <meshStandardMaterial color="#d6d9de" roughness={0.2} metalness={0.95} />
          </mesh>
        )),
      )}

      {/* Each colour: soft bloom shell, coloured tube, white-hot core. */}
      {built.groups.map((g) => (
        <group key={g.colour} position={[0, 0, tubeZ]}>
          <mesh geometry={g.shell}>
            <meshBasicMaterial
              color={g.colour}
              transparent
              opacity={0.16}
              blending={AdditiveBlending}
              toneMapped={false}
              depthWrite={false}
            />
          </mesh>
          <mesh geometry={g.core}>
            <meshBasicMaterial color={g.colour} toneMapped={false} />
          </mesh>
          <mesh geometry={g.inner}>
            <meshBasicMaterial color="#ffffff" toneMapped={false} transparent opacity={0.8} />
          </mesh>
        </group>
      ))}

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
  const [frame] = product.palette;
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

  if (round) {
    const r = w / 2;
    return (
      <group>
        <mesh position={[0, 0, d / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[r, r, d, 48]} />
          <meshStandardMaterial color={frame} roughness={0.5} metalness={0.3} />
        </mesh>
        <MirrorGlass shape={<circleGeometry args={[r * 0.93, 48]} />} position={[0, 0, d + 0.002]} />
      </group>
    );
  }

  return (
    <group>
      <mesh position={[0, 0, d / 2]} castShadow receiveShadow>
        <extrudeGeometry args={[archShape!, { depth: d, bevelEnabled: false }]} />
        <meshStandardMaterial color={frame} roughness={0.45} metalness={0.35} />
      </mesh>
      <MirrorGlass
        shape={<shapeGeometry args={[archShape!]} />}
        position={[0, 0, d + 0.002]}
        scale={[0.93, 0.95, 1]}
      />
    </group>
  );
}


/* ------------------------------------------------------------------ */
/* Lighting                                                            */
/* ------------------------------------------------------------------ */

/*
 * Lamps are lit from inside, which is exactly what makes them hard to draw.
 * At full emissive strength a shade has no shading left, and bloom turns it
 * into a flat glowing disc — a sticker of a lamp. So shells here glow only
 * partly and stay tone-mapped, letting the room's light model their form, and
 * the real brightness lives in a small bulb core inside them. That is also
 * how a real lamp photographs: a glowing shade with a hot spot, not a hole.
 */

/** A shade or vessel lit from within that still reads as a solid. */
function ShellMaterial({
  colour,
  glow,
  intensity = 0.55,
  opacity = 1,
  roughness = 0.45,
  flat = false,
  side,
}: {
  colour: string;
  glow: string;
  intensity?: number;
  opacity?: number;
  roughness?: number;
  flat?: boolean;
  side?: typeof DoubleSide | typeof BackSide;
}) {
  return (
    <meshStandardMaterial
      color={colour}
      emissive={glow}
      emissiveIntensity={intensity}
      roughness={roughness}
      metalness={0}
      transparent={opacity < 1}
      opacity={opacity}
      depthWrite={opacity >= 1}
      flatShading={flat}
      side={side}
    />
  );
}

/** The hot core inside a lamp — the only part bright enough to bloom. */
function Bulb({ colour, radius, position }: { colour: string; radius: number; position: Vec3 }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[radius, 16, 12]} />
      <meshBasicMaterial color={colour} toneMapped={false} />
    </mesh>
  );
}

/** A cylinder from one point to another — arms, rods, springs. */
function Rod({
  from,
  to,
  radius,
  children,
}: {
  from: Vec3;
  to: Vec3;
  radius: number;
  children: React.ReactNode;
}) {
  const a = new Vector3(...from);
  const dir = new Vector3(...to).sub(a);
  const length = dir.length();
  const quaternion = new Quaternion().setFromUnitVectors(UP, dir.normalize());
  const mid = new Vector3(...from).add(new Vector3(...to)).multiplyScalar(0.5);
  return (
    <mesh position={mid} quaternion={quaternion} castShadow>
      <cylinderGeometry args={[radius, radius, length, 10]} />
      {children}
    </mesh>
  );
}

const UP = new Vector3(0, 1, 0);

/** A surface of revolution from (radius, height) pairs, in metres. */
function lathe(points: [number, number][]) {
  return points.map(([r, y]) => new Vector2(Math.max(0.0005, r), y));
}

/**
 * Architect desk lamp: weighted base, twin-bar arms with springs, and a deep
 * shade angled over the desk with a visible bulb inside.
 *
 * Only the base counts as the footprint (see Product.footprint); the shade
 * reaches forward over the desk or past the front of a shelf, which is what
 * the 40cm depth in the catalogue describes.
 */
function DeskLamp({ product, light, lightScale = 1 }: ModelProps) {
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const w = M(product.dims.w);
  const [body, accent] = product.palette;
  const glow = product.emissive?.color ?? "#fff2d8";
  const spot = React.useRef<ThreeSpotLight>(null);
  const aim = React.useRef<Object3D>(null);

  React.useLayoutEffect(() => {
    if (spot.current && aim.current) spot.current.target = aim.current;
  }, [light]);

  const metal = <meshStandardMaterial color={body} roughness={0.35} metalness={0.6} />;
  const steel = <meshStandardMaterial color="#9a9ca1" roughness={0.3} metalness={0.85} />;

  // The base sits on the origin — it is the footprint placement uses — and
  // the arm reaches forward over whatever the lamp stands on.
  const baseR = Math.min(w * 0.5, d * 0.22);
  const pivot: Vec3 = [0, 0.05, 0];
  const elbow: Vec3 = [0, h * 0.82, -d * 0.08];
  const head: Vec3 = [0, h * 0.86, d * 0.5];
  const bar = 0.009;
  const tilt = -0.5; // shade angled forward, over the desk

  // Deep cone with a rolled neck, open at the mouth.
  const shadeH = Math.min(0.13, h * 0.26);
  const mouth = Math.min(w * 0.45, 0.075);
  const shade = lathe([
    [mouth, -shadeH],
    [mouth * 0.92, -shadeH * 0.72],
    [mouth * 0.62, -shadeH * 0.4],
    [0.02, -shadeH * 0.12],
    [0.016, 0],
    [0.004, 0.01],
  ]);

  return (
    <group>
      {/* Weighted base */}
      <mesh position={[0, 0.009, pivot[2]]} castShadow receiveShadow>
        <cylinderGeometry args={[baseR, baseR * 1.04, 0.018, 32]} />
        {metal}
      </mesh>
      <mesh position={[0, 0.03, pivot[2]]} castShadow>
        <cylinderGeometry args={[0.016, 0.02, 0.026, 16]} />
        {metal}
      </mesh>

      {/* Twin-bar arms */}
      {[-1, 1].map((s) => (
        <React.Fragment key={s}>
          <Rod from={[s * bar, pivot[1], pivot[2]]} to={[s * bar, elbow[1], elbow[2]]} radius={0.0045}>
            {metal}
          </Rod>
          <Rod from={[s * bar, elbow[1], elbow[2]]} to={[s * bar, head[1], head[2]]} radius={0.0045}>
            {metal}
          </Rod>
        </React.Fragment>
      ))}

      {/* Counterbalance springs — the detail that says "architect lamp" */}
      <Rod
        from={[bar * 2.6, pivot[1] + 0.04, pivot[2] + 0.01]}
        to={[bar * 2.6, elbow[1] - 0.06, elbow[2] + 0.01]}
        radius={0.004}
      >
        {steel}
      </Rod>
      <Rod
        from={[bar * 2.6, elbow[1] + 0.005, elbow[2] + 0.03]}
        to={[bar * 2.6, head[1] + 0.01, head[2] - 0.08]}
        radius={0.0035}
      >
        {steel}
      </Rod>

      {/* Joints */}
      {[pivot, elbow, head].map((p, i) => (
        <mesh key={i} position={p} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.012, 0.012, bar * 2 + 0.012, 16]} />
          {metal}
        </mesh>
      ))}

      {/* Shade */}
      <group position={head} rotation={[tilt, 0, 0]}>
        <mesh castShadow>
          <latheGeometry args={[shade, 32]} />
          <meshStandardMaterial color={body} roughness={0.38} metalness={0.5} side={DoubleSide} />
        </mesh>
        {/* Inner reflector: bright, so the opening reads as lit */}
        <mesh scale={[0.95, 0.98, 0.95]}>
          <latheGeometry args={[shade, 32]} />
          <ShellMaterial colour={accent ?? "#f3efe6"} glow={glow} intensity={0.7} side={BackSide} />
        </mesh>
        <Bulb colour={glow} radius={mouth * 0.34} position={[0, -shadeH * 0.5, 0]} />

        {light && product.emissive ? (
          <>
            <spotLight
              ref={spot}
              position={[0, -shadeH * 0.55, 0]}
              angle={0.75}
              penumbra={0.75}
              color={glow}
              intensity={product.emissive.lightIntensity * lightScale}
              distance={product.emissive.distance}
              decay={2}
              castShadow
              shadow-mapSize-width={512}
              shadow-mapSize-height={512}
              shadow-bias={-0.002}
            />
            <object3D ref={aim} position={[0, -1, 0]} />
          </>
        ) : null}
      </group>
    </group>
  );
}

/** 3D-printed moon: a cratered relief sphere resting in a wooden cradle. */
function MoonLamp({ product, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const r = w / 2;
  const standH = Math.max(0.012, h - w);
  const glow = product.emissive?.color ?? product.palette[0];
  const wood = product.palette[1] ?? "#5a3d26";
  const map = React.useMemo(() => moonTexture(), []);

  return (
    <group>
      <mesh position={[0, standH * 0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r * 0.62, r * 0.68, standH * 0.6, 28]} />
        <meshStandardMaterial color={wood} roughness={0.7} />
      </mesh>
      {/* Cradle ring the sphere sits in */}
      <mesh position={[0, standH, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[r * 0.5, Math.max(0.003, r * 0.06), 10, 32]} />
        <meshStandardMaterial color={wood} roughness={0.7} />
      </mesh>
      <mesh position={[0, standH + r * 0.88, 0]} castShadow>
        <sphereGeometry args={[r, 48, 32]} />
        <meshStandardMaterial
          color={product.palette[0]}
          map={map}
          bumpMap={map}
          bumpScale={3}
          emissive={glow}
          emissiveMap={map}
          emissiveIntensity={0.55}
          roughness={0.92}
        />
      </mesh>
      <ProductLight
        product={product}
        enabled={light}
        scale={lightScale}
        position={[0, standH + r * 0.88, 0]}
      />
    </group>
  );
}

/**
 * Lava lamp: metal cone base, tapered glass vessel, cap — and wax that
 * actually drifts, because a frozen lava lamp is the one thing that reads as
 * fake at a glance.
 */
function LavaLamp({ product, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const r = w / 2;
  const [wax, metal] = product.palette;
  const glow = product.emissive?.color ?? wax;
  const rnd = React.useMemo(() => seededRandom(product.id), [product.id]);
  const blobs = React.useMemo(
    () =>
      Array.from({ length: 4 }).map((_, i) => ({
        x: (rnd() - 0.5) * r * 0.24,
        z: (rnd() - 0.5) * r * 0.24,
        s: r * (0.18 + rnd() * 0.1),
        speed: 0.18 + rnd() * 0.14,
        phase: i * 1.7 + rnd(),
      })),
    [r, rnd],
  );
  const refs = React.useRef<(Object3D | null)[]>([]);

  const glassBottom = h * 0.33;
  const glassTop = h * 0.86;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    blobs.forEach((b, i) => {
      const m = refs.current[i];
      if (!m) return;
      const k = 0.5 - 0.5 * Math.cos(t * b.speed + b.phase);
      m.position.y = glassBottom + b.s + k * (glassTop - glassBottom - b.s * 3.2);
      // Narrower near the top of the vessel, so the wax narrows with it.
      const squeeze = 1 - k * 0.35;
      m.scale.set(squeeze, 1.35 + k * 0.25, squeeze);
    });
  });

  const base = lathe([
    [0, 0],
    [r, 0],
    [r * 0.98, h * 0.02],
    [r * 0.52, glassBottom],
    [0, glassBottom],
  ]);
  const glass = lathe([
    [0, glassBottom],
    [r * 0.5, glassBottom],
    [r * 0.63, h * 0.47],
    [r * 0.56, h * 0.63],
    [r * 0.36, glassTop],
    [0, glassTop],
  ]);
  const cap = lathe([
    [0, glassTop],
    [r * 0.38, glassTop],
    [r * 0.22, h],
    [0, h],
  ]);

  return (
    <group>
      <mesh castShadow receiveShadow>
        <latheGeometry args={[base, 36]} />
        <meshStandardMaterial color={metal ?? "#b8b8bc"} roughness={0.25} metalness={0.85} />
      </mesh>
      <mesh castShadow>
        <latheGeometry args={[cap, 36]} />
        <meshStandardMaterial color={metal ?? "#b8b8bc"} roughness={0.25} metalness={0.85} />
      </mesh>

      {/* Wax: a pool at the bottom and drifting blobs. Unlit on purpose — the
          lamp's own light sits among them, and at a few centimetres any lit
          material blows out to white. Wax glowing in liquid has no shading
          worth keeping anyway; the glass around it provides the form. */}
      <mesh position={[0, glassBottom + r * 0.06, 0]} scale={[1, 0.3, 1]}>
        <sphereGeometry args={[r * 0.48, 20, 12]} />
        <meshBasicMaterial color={wax} />
      </mesh>
      {blobs.map((b, i) => (
        <mesh
          key={i}
          ref={(m) => {
            refs.current[i] = m;
          }}
          position={[b.x, glassBottom + b.s, b.z]}
        >
          <sphereGeometry args={[b.s, 18, 12]} />
          <meshBasicMaterial color={wax} />
        </mesh>
      ))}

      {/* Liquid and glass, drawn after the wax so the wax shows through */}
      <mesh renderOrder={1}>
        <latheGeometry args={[glass, 36]} />
        <meshStandardMaterial
          color={product.palette[2] ?? "#ffd9a0"}
          emissive={glow}
          emissiveIntensity={0.22}
          roughness={0.05}
          metalness={0}
          transparent
          opacity={0.42}
          depthWrite={false}
        />
      </mesh>

      <Bulb colour={glow} radius={r * 0.16} position={[0, glassBottom + 0.004, 0]} />
      <ProductLight product={product} enabled={light} scale={lightScale} position={[0, h * 0.5, 0]} />
    </group>
  );
}

/** Himalayan salt lamp: a faceted, uneven crystal on a wooden plinth. */
function SaltLamp({ product, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const r = w / 2;
  const plinth = Math.min(0.03, h * 0.14);
  const rockH = h - plinth;
  const glow = product.emissive?.color ?? product.palette[0];

  const rock = React.useMemo(() => {
    const g = new IcosahedronGeometry(1, 1);
    const pos = g.attributes.position;
    const rnd = seededRandom(product.id);
    // Shared corners must move together or the facets tear apart, so the
    // offset is keyed on where the vertex is, not on its index.
    const offsets = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      if (!offsets.has(key)) offsets.set(key, 0.8 + rnd() * 0.32);
      const k = offsets.get(key)!;
      const taper = y > 0 ? 1 - y * 0.28 : 1;
      pos.setXYZ(i, x * k * taper * r * 0.95, (y * k * 0.5 + 0.5) * rockH, z * k * taper * r * 0.95);
    }
    g.computeVertexNormals();
    return g;
  }, [product.id, r, rockH]);

  return (
    <group>
      <mesh position={[0, plinth / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r * 0.78, r * 0.82, plinth, 24]} />
        <meshStandardMaterial color={product.palette[1] ?? "#3a2418"} roughness={0.75} />
      </mesh>
      <Bulb colour={glow} radius={r * 0.22} position={[0, plinth + rockH * 0.4, 0]} />
      <mesh geometry={rock} position={[0, plinth * 0.7, 0]} castShadow>
        <ShellMaterial
          colour={product.palette[0]}
          glow={glow}
          intensity={0.6}
          opacity={0.92}
          roughness={0.5}
          flat
        />
      </mesh>
      <ProductLight
        product={product}
        enabled={light}
        scale={lightScale}
        position={[0, plinth + rockH * 0.45, 0]}
      />
    </group>
  );
}

/** Jelly lamp: a glossy, slightly wobbly translucent dome on a dark base. */
function JellyLamp({ product, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const r = w / 2;
  const baseH = Math.min(0.018, h * 0.12);
  const bodyH = h - baseH;
  const glow = product.emissive?.color ?? product.palette[0];

  const profile = React.useMemo(() => {
    const pts: [number, number][] = [[0, 0]];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      // Rounded jelly silhouette with soft ridges down its side.
      const radius = r * Math.pow(1 - Math.pow(t, 2.4), 0.55) * (1 + 0.05 * Math.sin(t * Math.PI * 4));
      pts.push([radius, t * bodyH]);
    }
    return lathe(pts);
  }, [r, bodyH]);

  return (
    <group>
      <mesh position={[0, baseH / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r * 0.92, r * 0.96, baseH, 32]} />
        <meshStandardMaterial color={product.palette[1] ?? "#2a2438"} roughness={0.4} metalness={0.2} />
      </mesh>
      <Bulb colour={glow} radius={r * 0.24} position={[0, baseH + bodyH * 0.32, 0]} />
      <mesh position={[0, baseH, 0]} castShadow>
        <latheGeometry args={[profile, 40]} />
        <ShellMaterial colour={product.palette[0]} glow={glow} intensity={0.5} opacity={0.78} roughness={0.12} />
      </mesh>
      <ProductLight
        product={product}
        enabled={light}
        scale={lightScale}
        position={[0, baseH + bodyH * 0.4, 0]}
      />
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
  const glow = product.emissive?.color ?? product.palette[1] ?? "#ffffff";

  if (tall) {
    // Light tower: weighted round base, slim aluminium column, and a frosted
    // diffuser running up its face — lit partly, so the column keeps its form.
    const baseR = Math.min(w, d) * 0.5;
    const colW = Math.min(w, d) * (h > 1 ? 0.32 : 0.62);
    const colH = h - 0.02;
    return (
      <group>
        <mesh position={[0, 0.01, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[baseR * 0.96, baseR, 0.02, 32]} />
          <meshStandardMaterial color={body} roughness={0.35} metalness={0.7} />
        </mesh>
        <Slab args={[colW, colH, colW]} position={[0, 0.02 + colH / 2, 0]} colour={body} finish="metal" radius={colW * 0.3} />
        <mesh position={[0, 0.02 + colH / 2, colW / 2 + 0.0008]}>
          <planeGeometry args={[colW * 0.55, colH * 0.92]} />
          <ShellMaterial colour="#f4f4f6" glow={glow} intensity={1.4} />
        </mesh>
        <Bulb colour={glow} radius={colW * 0.12} position={[0, 0.02 + colH * 0.55, colW / 2 - colW * 0.15]} />
        <ProductLight product={product} enabled={light} scale={lightScale} position={[0, h * 0.6, d]} />
      </group>
    );
  }

  // Monitor light bar: a round aluminium bar on a clamp that hooks over the
  // back of the screen, light strip facing down and slightly forward.
  const barR = Math.min(h * 0.18, 0.012);
  return (
    <group>
      <group position={[0, h - barR, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[barR, barR, w, 24]} />
          <meshStandardMaterial color={body} roughness={0.3} metalness={0.75} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[(s * w) / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[barR * 1.05, barR * 1.05, 0.004, 24]} />
            <meshStandardMaterial color="#2a2a2e" roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[0, -barR * 0.98, barR * 0.25]} rotation={[Math.PI / 2 - 0.3, 0, 0]}>
          <planeGeometry args={[w * 0.94, barR * 0.9]} />
          <meshBasicMaterial color={glow} toneMapped={false} />
        </mesh>
      </group>
      {/* Clamp: front lip, top saddle and a counterweight hanging behind */}
      <Slab args={[0.05, 0.012, d * 0.9]} position={[0, h - barR * 2 - 0.006, -d * 0.05]} colour={body} finish="metal" radius={0.004} />
      <Slab args={[0.04, h * 0.7, 0.014]} position={[0, h * 0.4, -d / 2 + 0.007]} colour={body} finish="metal" radius={0.005} />
      <ProductLight product={product} enabled={light} scale={lightScale} position={[0, -0.01, d * 0.4]} />
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
      {/* Turned pot with a rolled rim, so it reads as ceramic, not a cup */}
      <mesh castShadow receiveShadow>
        <latheGeometry
          args={[
            lathe([
              [0, 0],
              [potR * 0.74, 0],
              [potR * 0.78, potH * 0.04],
              [potR * 0.93, potH * 0.82],
              [potR * 1.02, potH * 0.86],
              [potR * 1.03, potH],
              [potR * 0.9, potH],
              [potR * 0.88, potH * 0.9],
              [0, potH * 0.9],
            ]),
            36,
          ]}
        />
        <meshStandardMaterial color={pot ?? "#2a2724"} roughness={0.55} />
      </mesh>
      <mesh position={[0, potH * 0.91, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[potR * 0.88, 28]} />
        <meshStandardMaterial color="#2e2219" roughness={1} />
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

  if (product.tags.includes("keycaps")) {
    // A tray of individual sculpted caps rather than a coloured brick.
    const cols = 5;
    const rows = 3;
    const cw = (w * 0.9) / cols;
    const cd = (d * 0.84) / rows;
    return (
      <group>
        <Slab args={[w, h * 0.3, d]} position={[0, h * 0.15, 0]} colour="#1a1a1e" finish="plastic" radius={0.003} />
        {Array.from({ length: rows }).map((_, r) =>
          Array.from({ length: cols }).map((__, c) => (
            <Slab
              key={`${r}${c}`}
              args={[cw * 0.82, h * 0.62, cd * 0.82]}
              position={[-w * 0.45 + cw * (c + 0.5), h * 0.3 + h * 0.31, -d * 0.42 + cd * (r + 0.5)]}
              colour={(r + c) % 3 === 0 ? accent ?? body : body}
              finish="plastic"
              radius={Math.min(cw, cd) * 0.18}
            />
          )),
        )}
      </group>
    );
  }

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

      {/* Dome: a hemisphere, lit from inside — partly, so it keeps its curve */}
      <mesh position={[0, h * 0.62, 0]} castShadow>
        <sphereGeometry args={[r, 36, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <ShellMaterial colour={shade} glow={colour} intensity={0.55} roughness={0.42} side={DoubleSide} />
      </mesh>
      {/* Rolled rim, so the dome has an edge rather than a paper-thin lip */}
      <mesh position={[0, h * 0.62, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r * 0.985, Math.max(0.002, r * 0.04), 8, 40]} />
        <ShellMaterial colour={shade} glow={colour} intensity={0.55} roughness={0.42} />
      </mesh>
      {/* The light spills out underneath, where a real mushroom lamp is brightest */}
      <mesh position={[0, h * 0.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[r * 0.94, 28]} />
        <meshStandardMaterial color={shade} emissive={colour} emissiveIntensity={1.2} side={DoubleSide} />
      </mesh>
      <Bulb colour={colour} radius={r * 0.2} position={[0, h * 0.6 - r * 0.12, 0]} />

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

/* ================================================================== */
/* Shelves                                                             */
/* ================================================================== */

/**
 * Floating shelf: one board, softened edges, no visible bracket — the hidden
 * bracket is the whole point of the product. Origin on the wall, board out
 * along +z, top face at +h/2, which is what stackSurface() reports.
 */
function Shelf({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  return (
    <group>
      <Slab args={[w, h, d]} position={[0, 0, d / 2]} colour={product.palette[0]} radius={Math.min(0.006, h * 0.3)} />
    </group>
  );
}

/** Three open hexagon frames in a honeycomb cluster, each with a back panel. */
function HexShelf({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [wood, back] = product.palette;
  const R = Math.min(w / 3.5, h / (4 * 0.866));
  const a = R * 0.866;
  const t = Math.max(0.008, R * 0.12);
  // Flat-topped hexagons; neighbours sit 1.5R across and one apothem up/down.
  const cells: [number, number][] = [
    [-0.75 * R, 0],
    [0.75 * R, a],
    [0.75 * R, -a],
  ];

  return (
    <group>
      {cells.map(([cx, cy], i) => (
        <group key={i} position={[cx, cy, 0]}>
          <mesh position={[0, 0, 0.003]} receiveShadow>
            <circleGeometry args={[R - t * 0.5, 6]} />
            <meshStandardMaterial color={back ?? wood} roughness={0.7} />
          </mesh>
          {Array.from({ length: 6 }).map((_, k) => {
            const ang = (Math.PI / 3) * k + Math.PI / 6;
            return (
              <Slab
                key={k}
                args={[R + t * 0.55, t, d]}
                position={[Math.cos(ang) * (a - t / 2), Math.sin(ang) * (a - t / 2), d / 2]}
                rotation={[0, 0, ang + Math.PI / 2]}
                colour={wood}
                radius={0.002}
              />
            );
          })}
        </group>
      ))}
    </group>
  );
}

/** Wall bracket with two padded arms, and a game controller resting in it. */
function ControllerMount({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, accent] = product.palette;

  return (
    <group>
      <Slab args={[w * 0.42, h, 0.01]} position={[0, 0, 0.005]} colour={body} finish="plastic" radius={0.003} />
      {[-1, 1].map((s) => (
        <group key={s} position={[s * w * 0.24, -h * 0.25, 0]}>
          <Slab args={[0.012, 0.012, d]} position={[0, 0, d / 2]} colour={body} finish="plastic" radius={0.004} />
          <Slab args={[0.012, 0.028, 0.012]} position={[0, 0.01, d - 0.006]} colour={body} finish="plastic" radius={0.004} />
        </group>
      ))}

      {/* The controller itself: body, two grips, sticks and face buttons */}
      <group position={[0, -h * 0.25 + 0.022, d * 0.55]} rotation={[-0.35, 0, 0]}>
        <Slab args={[w * 1.25, 0.03, 0.055]} colour="#1c1c20" finish="plastic" radius={0.012} />
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * w * 0.5, -0.006, 0.026]} rotation={[0.9, 0, s * 0.3]} castShadow>
            <capsuleGeometry args={[0.014, 0.03, 4, 10]} />
            <meshStandardMaterial color="#1c1c20" roughness={0.38} />
          </mesh>
        ))}
        {[-1, 1].map((s) => (
          <mesh key={`k${s}`} position={[s * w * 0.2, 0.019, s * 0.008]}>
            <cylinderGeometry args={[0.007, 0.008, 0.01, 14]} />
            <meshStandardMaterial color="#2c2c30" roughness={0.6} />
          </mesh>
        ))}
        {[0, 1, 2, 3].map((i) => (
          <mesh key={`b${i}`} position={[w * 0.38 + Math.cos(i * 1.57) * 0.008, 0.017, -0.008 + Math.sin(i * 1.57) * 0.008]}>
            <sphereGeometry args={[0.003, 8, 6]} />
            <meshStandardMaterial color={accent ?? "#7c4dff"} emissive={accent ?? "#7c4dff"} emissiveIntensity={0.3} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Monitor riser: a deck on two side legs, with room under it for a keyboard. */
function MonitorRiser({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [top, legs] = product.palette;
  const deck = Math.min(0.018, h * 0.2);

  return (
    <group>
      <Slab args={[w, deck, d]} position={[0, h - deck / 2, 0]} colour={top} radius={0.005} />
      {[-1, 1].map((s) => (
        <Slab key={s} args={[0.022, h - deck, d * 0.92]} position={[s * (w / 2 - 0.03), (h - deck) / 2, 0]} colour={legs ?? top} radius={0.005} />
      ))}
      {/* Cable notch at the back */}
      <Slab args={[w * 0.2, deck * 0.6, 0.02]} position={[0, h - deck / 2, -d / 2 + 0.006]} colour={legs ?? top} radius={0.003} />
    </group>
  );
}

/** Two-bay desktop bookshelf with a few books in it. */
function MiniBookshelf({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, back] = product.palette;
  const t = 0.012;
  const rnd = useSeeded(product.id);
  const books = React.useMemo(() => {
    const spines = ["#c9a227", "#e8e2d4", "#6b2b2b", "#2a3a5a", "#3f6b46"];
    const out: { x: number; bw: number; bh: number; c: string }[] = [];
    let x = 0;
    while (x < w * 0.5) {
      const bw = 0.014 + rnd() * 0.012;
      out.push({ x: x + bw / 2, bw, bh: (h - t * 2) * (0.7 + rnd() * 0.25), c: spines[out.length % spines.length] });
      x += bw + 0.002;
    }
    return out;
  }, [w, h, rnd]);

  return (
    <group>
      {[-1, 1].map((s) => (
        <Slab key={s} args={[t, h, d]} position={[s * (w / 2 - t / 2), h / 2, 0]} colour={body} radius={0.003} />
      ))}
      <Slab args={[w, t, d]} position={[0, h - t / 2, 0]} colour={body} radius={0.003} />
      <Slab args={[w - t * 2, t, d]} position={[0, t / 2, 0]} colour={body} radius={0.003} />
      <Slab args={[t, h - t * 2, d - 0.004]} position={[w * 0.12, h / 2, 0]} colour={body} radius={0.002} />
      <mesh position={[0, h / 2, -d / 2 + 0.002]}>
        <planeGeometry args={[w - t * 2, h - t * 2]} />
        <meshStandardMaterial color={back ?? body} roughness={0.7} />
      </mesh>
      <group position={[-w / 2 + t + 0.004, t, 0]}>
        <MergedBoxes parts={books.map((b) => ({ size: [b.bw, b.bh, d * 0.8], position: [b.x, b.bh / 2, 0.004], colour: b.c }))}>
          <meshStandardMaterial vertexColors roughness={0.8} />
        </MergedBoxes>
      </group>
    </group>
  );
}

/* ================================================================== */
/* Vinyl figures                                                       */
/* ================================================================== */

/** One glossy vinyl figure: oversized rounded head, hair cap, tiny body. */
function VinylFigure({
  w,
  h,
  body,
  hair,
  skin,
  round = false,
}: {
  w: number;
  h: number;
  body: string;
  hair: string;
  skin: string;
  round?: boolean;
}) {
  const headH = h * 0.5;
  const headW = Math.min(w * 0.95, headH * 1.05);
  const bodyH = h * 0.3;
  const legH = h * 0.12;
  const headY = legH + bodyH + headH / 2 - h * 0.02;
  const vinyl = (c: string) => <meshStandardMaterial color={c} roughness={0.32} metalness={0} />;

  return (
    <group>
      <mesh position={[0, 0.003, 0]} receiveShadow>
        <cylinderGeometry args={[w * 0.42, w * 0.44, 0.006, 24]} />
        <meshStandardMaterial color="#141416" roughness={0.4} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * w * 0.11, legH / 2 + 0.004, 0]} castShadow>
          <capsuleGeometry args={[w * 0.08, legH * 0.5, 4, 10]} />
          {vinyl(body)}
        </mesh>
      ))}
      <Slab args={[w * 0.46, bodyH, w * 0.34]} position={[0, legH + bodyH / 2, 0]} colour={body} finish="plastic" radius={w * 0.12} />
      {[-1, 1].map((s) => (
        <mesh key={`a${s}`} position={[s * w * 0.29, legH + bodyH * 0.55, 0]} rotation={[0, 0, s * 0.18]} castShadow>
          <capsuleGeometry args={[w * 0.055, bodyH * 0.55, 4, 10]} />
          {vinyl(skin)}
        </mesh>
      ))}

      {/* The head is the entire visual language of the format */}
      {round ? (
        <mesh position={[0, headY, 0]} scale={[headW / 2, headH / 2, headW / 2.1]} castShadow>
          <sphereGeometry args={[1, 28, 20]} />
          {vinyl(skin)}
        </mesh>
      ) : (
        <Slab args={[headW, headH, headW * 0.9]} position={[0, headY, 0]} colour={skin} finish="plastic" radius={headW * 0.28} />
      )}
      {/* Hair cap over the top and back of the head */}
      <mesh
        position={[0, headY + headH * 0.12, -headW * 0.04]}
        scale={[headW * 0.56, headH * 0.48, headW * 0.52]}
        castShadow
      >
        <sphereGeometry args={[1, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        {vinyl(hair)}
      </mesh>
      {/* Eyes with a catch-light, which is what makes them read as eyes */}
      {[-1, 1].map((s) => (
        <group key={`e${s}`} position={[s * headW * 0.2, headY - headH * 0.05, headW * (round ? 0.47 : 0.452)]}>
          <mesh>
            <circleGeometry args={[headW * 0.085, 18]} />
            <meshStandardMaterial color="#121216" roughness={0.15} />
          </mesh>
          <mesh position={[headW * 0.025, headW * 0.03, 0.0005]}>
            <circleGeometry args={[headW * 0.022, 10]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Astronaut({ w, h, suit, visor }: { w: number; h: number; suit: string; visor: string }) {
  const helmetR = Math.min(w * 0.42, h * 0.24);
  const bodyH = h * 0.32;
  const legH = h * 0.2;
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * w * 0.13, legH / 2, 0]} castShadow>
          <capsuleGeometry args={[w * 0.1, legH * 0.55, 4, 10]} />
          <FinishMaterial colour={suit} finish="fabric" />
        </mesh>
      ))}
      <Slab args={[w * 0.58, bodyH, w * 0.44]} position={[0, legH + bodyH / 2, 0]} colour={suit} finish="fabric" radius={w * 0.16} />
      <Slab args={[w * 0.46, bodyH * 0.9, w * 0.22]} position={[0, legH + bodyH / 2, -w * 0.3]} colour="#cfd2d8" finish="plastic" radius={w * 0.06} />
      {[-1, 1].map((s) => (
        <mesh key={`a${s}`} position={[s * w * 0.36, legH + bodyH * 0.55, w * 0.03]} rotation={[0.3, 0, s * 0.35]} castShadow>
          <capsuleGeometry args={[w * 0.085, bodyH * 0.6, 4, 10]} />
          <FinishMaterial colour={suit} finish="fabric" />
        </mesh>
      ))}
      <group position={[0, legH + bodyH + helmetR * 0.9, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[helmetR, 32, 24]} />
          <meshStandardMaterial color={suit} roughness={0.3} />
        </mesh>
        {/* Gold-tinted reflective visor */}
        <mesh position={[0, -helmetR * 0.02, helmetR * 0.2]} scale={[0.84, 0.66, 0.9]}>
          <sphereGeometry args={[helmetR, 28, 20, Math.PI * 0.05, Math.PI * 0.9, Math.PI * 0.25, Math.PI * 0.5]} />
          <meshStandardMaterial color={visor} roughness={0.08} metalness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

function Cat({ r, colour, accent }: { r: number; colour: string; accent: string }) {
  const ceramic = <meshStandardMaterial color={colour} roughness={0.22} metalness={0} />;
  return (
    <group>
      <mesh position={[0, r * 1.05, 0]} scale={[1, 1.15, 0.92]} castShadow>
        <sphereGeometry args={[r, 24, 18]} />
        {ceramic}
      </mesh>
      <mesh position={[0, r * 2.35, r * 0.08]} castShadow>
        <sphereGeometry args={[r * 0.62, 22, 16]} />
        {ceramic}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * r * 0.36, r * 2.85, r * 0.06]} rotation={[0, 0, -s * 0.3]} castShadow>
          <coneGeometry args={[r * 0.2, r * 0.38, 10]} />
          {ceramic}
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`e${s}`} position={[s * r * 0.22, r * 2.42, r * 0.62]} scale={[1, 1.4, 1]}>
          <sphereGeometry args={[r * 0.06, 8, 6]} />
          <meshStandardMaterial color="#141416" roughness={0.2} />
        </mesh>
      ))}
      <mesh position={[0, r * 2.28, r * 0.68]}>
        <sphereGeometry args={[r * 0.05, 8, 6]} />
        <meshStandardMaterial color={accent} roughness={0.3} />
      </mesh>
      {/* Tail curled round the base */}
      <mesh position={[0, r * 0.18, 0]} rotation={[Math.PI / 2, 0, 0.6]} castShadow>
        <torusGeometry args={[r * 0.95, r * 0.13, 10, 24, Math.PI * 0.9]} />
        {ceramic}
      </mesh>
    </group>
  );
}

function Funko({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [a, b, c] = product.palette;
  const tags = product.tags;

  if (tags.includes("cat")) {
    const cats = [
      { x: -w * 0.3, r: Math.min(w, d) * 0.2, col: a },
      { x: w * 0.02, r: Math.min(w, d) * 0.25, col: b ?? a },
      { x: w * 0.33, r: Math.min(w, d) * 0.17, col: c ?? a },
    ];
    return (
      <group>
        {cats.map((cat, i) => (
          <group key={i} position={[cat.x, 0, (i % 2) * d * 0.1]} rotation={[0, (i - 1) * 0.3, 0]}>
            <Cat r={Math.min(cat.r, h / 3.2)} colour={cat.col} accent="#e88a9a" />
          </group>
        ))}
      </group>
    );
  }

  if (tags.includes("astronaut")) {
    return <Astronaut w={w} h={h} suit={a} visor="#d9a441" />;
  }

  const chibi = tags.includes("chibi");
  const skin = chibi ? c ?? "#f6e7c1" : "#f1dcc6";
  if (tags.includes("set")) {
    const colours = product.palette;
    return (
      <group>
        {[-1, 0, 1].map((s, i) => (
          <group key={s} position={[s * w * 0.36, 0, (i % 2) * d * 0.12]} scale={0.62}>
            <VinylFigure w={w} h={h} body={colours[i % colours.length]} hair={colours[(i + 1) % colours.length]} skin={skin} round={chibi} />
          </group>
        ))}
      </group>
    );
  }
  return <VinylFigure w={w} h={h} body={a} hair={b ?? a} skin={c ?? skin} round={chibi} />;
}

/* ================================================================== */
/* Audio, gaming, display                                              */
/* ================================================================== */

function Speaker({ product, light, lightScale = 1 }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, accent] = product.palette;

  if (product.tags.includes("arcade")) {
    const lowerH = h * 0.42;
    const upperH = h * 0.46;
    const side = accent ?? "#141416";
    return (
      <group>
        {/* Cabinet: lower body, jutting control deck, recessed upper body */}
        <Slab args={[w, lowerH, d * 0.82]} position={[0, lowerH / 2, -d * 0.09]} colour={body} finish="plastic" radius={0.004} />
        <Slab args={[w, h * 0.05, d * 0.42]} position={[0, lowerH + h * 0.02, d * 0.22]} rotation={[0.25, 0, 0]} colour={side} finish="plastic" radius={0.003} />
        <Slab args={[w, upperH, d * 0.62]} position={[0, lowerH + upperH / 2 + h * 0.04, -d * 0.19]} colour={body} finish="plastic" radius={0.004} />
        {/* Marquee, lit */}
        <mesh position={[0, h - h * 0.06, d * 0.12 + 0.001]}>
          <planeGeometry args={[w * 0.86, h * 0.09]} />
          <meshStandardMaterial color="#ffd36b" emissive="#ffb84d" emissiveIntensity={0.9} />
        </mesh>
        {/* Screen set into a dark bezel */}
        <group position={[0, lowerH + upperH * 0.55, d * 0.12 + 0.001]} rotation={[-0.12, 0, 0]}>
          <mesh>
            <planeGeometry args={[w * 0.84, upperH * 0.62]} />
            <meshStandardMaterial color="#0c0c10" roughness={0.3} />
          </mesh>
          <mesh position={[0, 0, 0.001]}>
            <planeGeometry args={[w * 0.7, upperH * 0.5]} />
            <Emissive product={product} intensityScale={0.6} />
          </mesh>
        </group>
        {/* Joystick and buttons on the deck */}
        <group position={[0, lowerH + h * 0.05, d * 0.25]} rotation={[0.25, 0, 0]}>
          <mesh position={[-w * 0.2, h * 0.025, 0]}>
            <cylinderGeometry args={[0.0018, 0.0018, h * 0.05, 8]} />
            <meshStandardMaterial color="#1a1a1c" />
          </mesh>
          <mesh position={[-w * 0.2, h * 0.055, 0]}>
            <sphereGeometry args={[w * 0.05, 12, 10]} />
            <meshStandardMaterial color="#e33" roughness={0.3} />
          </mesh>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[w * (0.05 + i * 0.12), h * 0.008, 0]}>
              <cylinderGeometry args={[w * 0.035, w * 0.035, h * 0.012, 12]} />
              <meshStandardMaterial color={["#f2c14e", "#3fa9f5", "#7cd36b"][i]} roughness={0.3} />
            </mesh>
          ))}
        </group>
        {/* Side art stripe */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (w / 2 + 0.0006), h * 0.55, -d * 0.1]} rotation={[0, s * Math.PI / 2, 0]}>
            <planeGeometry args={[d * 0.5, h * 0.06]} />
            <meshStandardMaterial color="#f2c14e" roughness={0.5} />
          </mesh>
        ))}
        <ProductLight product={product} enabled={light} scale={lightScale} position={[0, h * 0.7, d]} />
      </group>
    );
  }

  const r = Math.min(w, d) / 2;
  return (
    <group>
      {/* Rubber foot */}
      <mesh position={[0, h * 0.02, 0]} receiveShadow>
        <cylinderGeometry args={[r * 0.92, r * 0.88, h * 0.04, 30]} />
        <meshStandardMaterial color="#141416" roughness={0.8} />
      </mesh>
      {/* Fabric-wrapped body */}
      <mesh position={[0, h * 0.48, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, h * 0.88, 36]} />
        <FinishMaterial colour={body} finish="fabric" />
      </mesh>
      {/* Rubberised top cap with controls */}
      <mesh position={[0, h * 0.94, 0]} castShadow>
        <cylinderGeometry args={[r * 0.97, r, h * 0.05, 36]} />
        <meshStandardMaterial color={accent ?? "#3a3a40"} roughness={0.55} />
      </mesh>
      {[-1, 0, 1].map((s) => (
        <mesh key={s} position={[s * r * 0.4, h * 0.97, 0]}>
          <cylinderGeometry args={[r * 0.12, r * 0.12, h * 0.012, 14]} />
          <meshStandardMaterial color="#202024" roughness={0.4} />
        </mesh>
      ))}
      {/* Carry strap loop */}
      <mesh position={[0, h * 0.99, -r * 0.6]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <torusGeometry args={[r * 0.28, r * 0.05, 8, 20, Math.PI]} />
        <meshStandardMaterial color="#1a1a1e" roughness={0.7} />
      </mesh>
      {/* Status light */}
      <mesh position={[0, h * 0.08, r + 0.0005]}>
        <circleGeometry args={[r * 0.05, 10]} />
        <meshBasicMaterial color="#4dd2ff" toneMapped={false} />
      </mesh>
    </group>
  );
}

/** A katana in its scabbard: lacquered saya, guard, wrapped hilt. */
function Katana({ length, colour, wrap }: { length: number; colour: string; wrap: string }) {
  const curve = React.useMemo(
    () =>
      new CatmullRomCurve3([
        new Vector3(-length * 0.22, 0, 0),
        new Vector3(length * 0.15, length * 0.012, 0),
        new Vector3(length * 0.5, length * 0.035, 0),
      ]),
    [length],
  );
  const r = length * 0.016;
  return (
    <group>
      <mesh castShadow>
        <tubeGeometry args={[curve, 24, r, 10, false]} />
        <meshStandardMaterial color={colour} roughness={0.18} metalness={0.2} />
      </mesh>
      <mesh position={[length * 0.5, length * 0.035, 0]} castShadow>
        <sphereGeometry args={[r, 10, 8]} />
        <meshStandardMaterial color={colour} roughness={0.18} />
      </mesh>
      {/* Tsuba (guard) */}
      <mesh position={[-length * 0.23, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[r * 2.4, r * 2.4, r * 0.7, 18]} />
        <meshStandardMaterial color="#b08d3c" roughness={0.3} metalness={0.85} />
      </mesh>
      {/* Tsuka (hilt) with its diamond wrap suggested by banding */}
      <mesh position={[-length * 0.37, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[r * 1.05, r * 1.05, length * 0.27, 12]} />
        <meshStandardMaterial color={wrap} roughness={0.85} />
      </mesh>
      {Array.from({ length: 6 }).map((_, i) => (
        <mesh key={i} position={[-length * (0.26 + i * 0.044), 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[r * 1.07, r * 0.18, 6, 14]} />
          <meshStandardMaterial color="#e8e2d4" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function HeadphoneStand({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [metal, dark] = product.palette;

  if (product.tags.includes("katana")) {
    const baseH = h * 0.09;
    return (
      <group>
        <Slab args={[w * 0.9, baseH, d]} position={[0, baseH / 2, 0]} colour="#2a1d14" finish="wood" radius={0.006} />
        {[-1, 1].map((s) => (
          <group key={s} position={[s * w * 0.3, 0, 0]}>
            {/* Curved upright with two cradles */}
            <Slab args={[w * 0.05, h * 0.86, d * 0.55]} position={[0, baseH + h * 0.43, 0]} colour={metal} finish="plastic" radius={0.008} />
            {[0.5, 0.82].map((f) => (
              <Slab key={f} args={[w * 0.06, h * 0.04, d * 0.75]} position={[0, h * f, d * 0.08]} colour={metal} finish="plastic" radius={0.008} />
            ))}
          </group>
        ))}
        <group position={[0, h * 0.53 + 0.01, d * 0.1]}>
          <Katana length={w} colour={metal} wrap={dark ?? "#c9302c"} />
        </group>
        <group position={[0, h * 0.85 + 0.01, d * 0.1]}>
          <Katana length={w * 0.78} colour={metal} wrap={dark ?? "#c9302c"} />
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

/* ================================================================== */
/* Soft seating                                                        */
/* ================================================================== */

function BeanBag({ product }: ModelProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [main, accent] = product.palette;

  // A slumped teardrop, not two balls: a sphere with its base flattened onto
  // the floor, the back pushed up and the seat pressed in where someone sat.
  const geometry = React.useMemo(() => {
    const g = new SphereGeometry(1, 48, 36);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      let y = p.getY(i);
      const z = p.getZ(i);
      if (y < 0) y *= 0.42;
      if (z < 0 && y > 0) y += -z * y * 0.55;
      if (z > -0.1 && y > 0.1) y -= y * Math.max(0, z + 0.1) * 0.45 * (1 - Math.abs(x) * 0.6);
      p.setY(i, (y + 0.42) / 1.6);
    }
    g.computeVertexNormals();
    return g;
  }, []);

  if (product.tags.includes("inflatable")) {
    const tube = Math.min(w, d) * 0.14;
    const ringR = Math.min(w, d) * 0.33;
    const vinyl = (
      <meshPhysicalMaterial color={main} roughness={0.06} transparent opacity={0.6} clearcoat={1} depthWrite={false} />
    );
    return (
      <group>
        <mesh position={[0, tube, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[ringR, tube, 16, 40]} />
          {vinyl}
        </mesh>
        <mesh position={[0, tube * 2.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[ringR * 0.9, tube * 0.85, 16, 40]} />
          {vinyl}
        </mesh>
        <mesh position={[0, h * 0.62, -d * 0.24]} rotation={[0.35, 0, 0]}>
          <torusGeometry args={[ringR * 0.85, tube * 0.8, 16, 40]} />
          <meshPhysicalMaterial color={accent ?? main} roughness={0.06} transparent opacity={0.6} clearcoat={1} depthWrite={false} />
        </mesh>
      </group>
    );
  }

  return (
    <group>
      <mesh geometry={geometry} scale={[w / 2, h, d / 2]} castShadow receiveShadow>
        <FinishMaterial colour={main} finish="fabric" />
      </mesh>
      {/* Carry handle on the back */}
      <mesh position={[0, h * 0.75, -d * 0.43]} rotation={[0.4, 0, 0]}>
        <torusGeometry args={[w * 0.06, w * 0.012, 6, 14, Math.PI]} />
        <FinishMaterial colour={accent ?? main} finish="fabric" />
      </mesh>
    </group>
  );
}

/* ================================================================== */
/* User-made items                                                     */
/* ================================================================== */

const customTextures = new Map<string, Texture>();

/** One decoded texture per item version, shared by every placed copy. */
function useCustomImageTexture(key: string, dataUrl?: string): Texture | null {
  const [tex, setTex] = React.useState<Texture | null>(() => customTextures.get(key) ?? null);
  React.useEffect(() => {
    if (!dataUrl) {
      setTex(null);
      return;
    }
    const hit = customTextures.get(key);
    if (hit) {
      setTex(hit);
      return;
    }
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (!live) return;
      const t = new Texture(img);
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 8;
      t.needsUpdate = true;
      customTextures.set(key, t);
      setTex(t);
    };
    img.src = dataUrl;
    return () => {
      live = false;
    };
  }, [key, dataUrl]);
  return tex;
}

/**
 * A cutout with real thickness: front and back faces carry the photo, and a
 * stack of slightly darker alpha-cut layers between them forms the edge, so
 * from an angle it reads as a solid standee rather than a sheet of paper.
 * The edge layers are merged into one mesh — one draw call however thick.
 */
function ThickCutout({
  texture,
  w,
  h,
  t,
  glow,
}: {
  texture: Texture;
  w: number;
  h: number;
  t: number;
  glow?: string;
}) {
  const layers = Math.max(3, Math.min(10, Math.round(t / 0.003)));
  const edge = React.useMemo(() => {
    const geos = Array.from({ length: layers }).map((_, i) => {
      const g = new PlaneGeometry(w, h);
      g.translate(0, 0, -t / 2 + (t * (i + 0.5)) / layers);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    return merged;
  }, [w, h, t, layers]);
  React.useEffect(() => () => edge?.dispose(), [edge]);

  const face = (z: number, flip: boolean) => (
    <mesh position={[0, 0, z]} rotation={[0, flip ? Math.PI : 0, 0]} castShadow>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial
        map={texture}
        alphaTest={0.4}
        roughness={0.6}
        emissive={glow}
        emissiveMap={glow ? texture : undefined}
        emissiveIntensity={glow ? 0.8 : 0}
      />
    </mesh>
  );

  return (
    <group>
      {face(t / 2, false)}
      {face(-t / 2, true)}
      {edge ? (
        <mesh geometry={edge} castShadow>
          <meshStandardMaterial map={texture} alphaTest={0.4} color="#8f8f8f" roughness={0.8} side={DoubleSide} />
        </mesh>
      ) : null}
    </group>
  );
}

/** The photo inflated into a rounded solid — see lib/three/inflate.ts. */
function SculptedCutout({
  texture,
  cacheKey,
  w,
  h,
  d,
  flatBack,
  glow,
  grounded = false,
  squareness = 2,
  fillBase = false,
}: {
  texture: Texture;
  cacheKey: string;
  w: number;
  h: number;
  d: number;
  flatBack: boolean;
  glow?: string;
  grounded?: boolean;
  squareness?: number;
  fillBase?: boolean;
}) {
  const geometry = React.useMemo(
    () =>
      inflatedGeometry(cacheKey, texture.image as HTMLImageElement, {
        width: w,
        height: h,
        depth: d,
        flatBack,
        grounded,
        squareness,
        fillBase,
      }),
    [cacheKey, texture, w, h, d, flatBack, grounded, squareness, fillBase],
  );
  // An opaque copy with the edge colours bled outward — the mesh defines the
  // silhouette, so the rim must not sample transparent fringe.
  const solid = React.useMemo(() => {
    const t = new CanvasTexture(bledCanvas(cacheKey, texture.image as HTMLImageElement));
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [cacheKey, texture]);
  React.useEffect(() => () => solid.dispose(), [solid]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        map={solid}
        vertexColors
        roughness={0.55}
        metalness={0}
        emissive={glow}
        emissiveMap={glow ? solid : undefined}
        emissiveIntensity={glow ? 0.8 : 0}
      />
    </mesh>
  );
}

const _mirrorPos = new Vector3();

/**
 * Mirror glass that reflects the actual room.
 *
 * A cube camera captures the scene from where the mirror stands, with the
 * glass hidden, and the glass shows that capture. It re-captures only once
 * the mirror has stayed put for a few frames — six small renders after a
 * move, not a second scene render every frame, which a phone can't afford.
 */
function MirrorGlass({
  shape,
  mask,
  position,
  scale,
}: {
  /** The glass outline as a geometry element (a plane, a circle, an arch). */
  shape: React.ReactNode;
  /** Cuts the glass to a photo's mirror opening (alpha = glass). */
  mask?: Texture;
  position?: Vec3;
  scale?: Vec3;
}) {
  const gl = useThree((st) => st.gl);
  const scene = useThree((st) => st.scene);
  const target = React.useMemo(() => new WebGLCubeRenderTarget(256, { type: HalfFloatType }), []);
  const camera = React.useMemo(() => new CubeCamera(0.05, 30, target), [target]);
  const mesh = React.useRef<Mesh>(null);
  const last = React.useRef(new Vector3(Infinity, 0, 0));
  const still = React.useRef(0);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => () => target.dispose(), [target]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    m.getWorldPosition(_mirrorPos);
    if (_mirrorPos.distanceToSquared(last.current) > 1e-6) {
      last.current.copy(_mirrorPos);
      still.current = 6;
      return;
    }
    if (still.current > 0 && --still.current === 0) {
      camera.position.copy(_mirrorPos);
      m.visible = false;
      // The walls hidden so the user can see into the room are still there
      // for the mirror — a mirror facing the open side reflects that wall.
      const shown: Object3D[] = [];
      scene.traverse((o) => {
        if (o.userData.isRoom && !o.visible) {
          o.visible = true;
          shown.push(o);
        }
      });
      camera.update(gl, scene);
      for (const o of shown) o.visible = false;
      m.visible = true;
      if (!ready) setReady(true);
    }
  });

  // A basic material reads the capture as a plain cube map: a perfect mirror
  // needs no blur, so it skips the prefiltering a standard material does.
  const cut = mask ? { map: mask, alphaTest: 0.5 } : {};
  return (
    <group position={position} scale={scale}>
      <mesh ref={mesh}>
        {shape}
        {ready ? (
          <meshBasicMaterial {...cut} envMap={target.texture} color="#f1f5f7" />
        ) : (
          <meshStandardMaterial {...cut} color="#c9d2d8" roughness={0.05} metalness={0.9} />
        )}
      </mesh>
      {/* The back of a mirror is its backing board, not more glass. */}
      <mesh position={[0, 0, -0.002]}>
        {shape}
        <meshStandardMaterial {...cut} color="#3b3a38" roughness={0.9} side={BackSide} />
      </mesh>
    </group>
  );
}

/**
 * Turns its children about Y to face the camera, keeping them upright.
 * `limit` caps the turn either side of the placed direction, in radians.
 */
function FaceCamera({ children, limit = Math.PI }: { children: React.ReactNode; limit?: number }) {
  const ref = React.useRef<Group>(null);
  const v = React.useMemo(() => new Vector3(), []);
  useFrame(({ camera }) => {
    const g = ref.current;
    if (!g?.parent) return;
    v.copy(camera.position);
    g.parent.worldToLocal(v);
    const a = Math.atan2(v.x, v.z);
    g.rotation.y = Math.max(-limit, Math.min(limit, a));
  });
  return <group ref={ref}>{children}</group>;
}

function CustomModel({ product, light, lightScale = 1 }: ModelProps) {
  const spec = product.custom;
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const glow = product.emissive?.color;
  const texKey = `${product.id}:${spec?.updatedAt ?? 0}`;
  const texture = useCustomImageTexture(texKey, spec?.image);
  const glassTex = useCustomImageTexture(`${texKey}:glass`, spec?.glass);
  const mount = product.mount;

  // ---- Plain shape: no photo, just a well-finished primitive ----
  if (!spec?.image) {
    const colour = product.palette[0];
    const finish =
      spec?.finish === "metal" ? "metal" : spec?.finish === "wood" ? "wood" : spec?.finish === "fabric" ? "fabric" : spec?.finish === "gloss" ? "plastic" : "paint";
    const material = glow ? (
      <ShellMaterial colour={colour} glow={glow} intensity={0.6} />
    ) : (
      <FinishMaterial colour={colour} finish={finish} roughness={spec?.finish === "matte" ? 0.85 : undefined} />
    );
    // Centre each shape on its mount face, the way every model is authored.
    const centre: Vec3 =
      mount === "wall" ? [0, 0, d / 2] : mount === "ceiling" ? [0, -h / 2, 0] : [0, h / 2, 0];
    const shape =
      spec?.shape === "sphere" ? (
        <mesh position={centre} scale={[w / 2, h / 2, d / 2]} castShadow receiveShadow>
          <sphereGeometry args={[1, 40, 28]} />
          {material}
        </mesh>
      ) : spec?.shape === "cylinder" ? (
        <mesh position={centre} scale={[w / 2, 1, d / 2]} castShadow receiveShadow>
          <cylinderGeometry args={[1, 1, h, 40]} />
          {material}
        </mesh>
      ) : (
        <RoundedBox args={[w, h, d]} radius={Math.min(0.01, Math.min(w, h, d) * 0.2)} smoothness={2} bevelSegments={2} position={centre} castShadow receiveShadow>
          {material}
        </RoundedBox>
      );
    return (
      <group>
        {shape}
        <ProductLight product={product} enabled={light} scale={lightScale} position={centre} />
      </group>
    );
  }

  if (!texture) return null;
  const style = spec.style;
  const t = style === "flat" ? 0 : Math.min(0.03, Math.max(0.006, d * 0.25));

  // ---- Rug: the photo laid on the floor, w × d, with a little pile ----
  if (style === "rug") {
    const pile = Math.max(0.003, Math.min(h, 0.02));
    return (
      <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, pile, 0]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial map={texture} alphaTest={0.4} roughness={0.95} metalness={0} />
        </mesh>
        {/* The underside edge, so it reads as a mat with thickness, not a decal. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, pile * 0.4, 0]} scale={[1.004, 1.004, 1]}>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial map={texture} alphaTest={0.4} color="#6f6a64" roughness={1} />
        </mesh>
      </group>
    );
  }

  // The reflective glass of a mirror, shaped by the mask the frame encloses.
  const glassAt = (z: number) =>
    glassTex ? (
      <MirrorGlass mask={glassTex} shape={<planeGeometry args={[w, h]} />} position={[0, 0, z]} />
    ) : null;

  // ---- Wall: flat against the wall, or proud of it with real thickness ----
  if (mount === "wall") {
    return (
      <group>
        {glow ? <WallGlow colour={glow} width={w} height={h} spread={2.2} opacity={0.5} /> : null}
        {glassAt(0.005)}
        {style === "sculpted" ? (
          <group position={[0, 0, 0.002]}>
            <SculptedCutout texture={texture} cacheKey={texKey} w={w} h={h} d={Math.max(0.01, d)} flatBack glow={glow} />
          </group>
        ) : style === "flat" ? (
          <mesh position={[0, 0, 0.006]} castShadow>
            <planeGeometry args={[w, h]} />
            <meshStandardMaterial
              map={texture}
              alphaTest={0.4}
              roughness={0.7}
              emissive={glow}
              emissiveMap={glow ? texture : undefined}
              emissiveIntensity={glow ? 0.8 : 0}
            />
          </mesh>
        ) : (
          <group position={[0, 0, t / 2 + 0.002]}>
            <ThickCutout texture={texture} w={w} h={h} t={t} glow={glow} />
          </group>
        )}
        <ProductLight product={product} enabled={light} scale={lightScale} position={[0, 0, 0.2]} />
      </group>
    );
  }

  // ---- Standing or hanging: a standee, optionally turning to face you ----
  const y = mount === "ceiling" ? -h / 2 : h / 2;
  const body =
    style === "sculpted" ? (
      <SculptedCutout
        texture={texture}
        cacheKey={texKey}
        w={w}
        h={h}
        d={Math.max(0.01, d)}
        flatBack={false}
        glow={glow}
        // Standing things rest on a flat base; furniture gets square shoulders.
        grounded={mount !== "ceiling"}
        squareness={mount === "floor" && !spec.glass ? 2.4 : 2}
        fillBase={mount === "floor" && !spec.glass}
      />
    ) : style === "flat" ? (
      <mesh castShadow>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={texture} alphaTest={0.4} roughness={0.7} side={DoubleSide} />
      </mesh>
    ) : (
      <ThickCutout texture={texture} w={w} h={h} t={t} glow={glow} />
    );

  return (
    <group position={[0, y, 0]}>
      {style === "facing" ? (
        <FaceCamera>{body}</FaceCamera>
      ) : style === "sculpted" && !spec.glass && mount !== "ceiling" ? (
        // One photo shows one side; seen from the side or behind, a shape
        // puffed out of it smears into streaks. So it always shows the side
        // that was photographed — with real depth, shading and a flat base,
        // it still reads as a solid object rather than a cardboard cutout.
        <FaceCamera>{body}</FaceCamera>
      ) : (
        body
      )}
      {style === "facing" ? null : glassAt(0)}
      <ProductLight product={product} enabled={light} scale={lightScale} position={[0, 0, 0.15]} />
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
  hexShelf: HexShelf,
  controllerMount: ControllerMount,
  monitorRiser: MonitorRiser,
  miniBookshelf: MiniBookshelf,
  deskLamp: DeskLamp,
  moonLamp: MoonLamp,
  lavaLamp: LavaLamp,
  saltLamp: SaltLamp,
  jellyLamp: JellyLamp,
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
  custom: CustomModel,
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
