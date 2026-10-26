"use client";

import * as React from "react";
import {
  CanvasTexture,
  DoubleSide,
  ExtrudeGeometry,
  LatheGeometry,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
  type Texture,
} from "three";
import type { Product } from "@/lib/catalog/types";
import type { Vec3 } from "@/lib/room/types";
import { weaveTexture } from "@/lib/three/textures";
import { FinishMaterial, Leg, Slab, type Finish } from "./finish";
import { TemplateModel } from "./templates";
import { M, seededRandom } from "./shapes";

/**
 * Everyday decor and furniture pieces: tables, chairs, curtains, lamps,
 * cushions, baskets and fabric hangings.
 *
 * Each is modelled on the most common version of that product as it is sold
 * online — the two-tier round coffee table, the moulded "Eames-style" chair,
 * pleated blackout curtains on a rod — so the piece in the room reads as the
 * thing behind the shop link. Same conventions as ProductModel: true size in
 * metres, floor and tabletop pieces sit on y = 0 with their front towards +z,
 * wall pieces are centred on their wall point and stand out along +z.
 */

interface Props {
  product: Product;
  light?: boolean;
  lightScale?: number;
}

const UP = new Vector3(0, 1, 0);

/** A cylinder from one point to another — splayed legs, rods, struts. */
function Strut({
  from,
  to,
  radius,
  colour,
  finish = "auto",
  taper = 1,
}: {
  from: Vec3;
  to: Vec3;
  radius: number;
  colour: string;
  finish?: Finish;
  /** Radius at `to` relative to `from`. */
  taper?: number;
}) {
  const a = new Vector3(...from);
  const dir = new Vector3(...to).sub(a);
  const length = dir.length();
  const quaternion = new Quaternion().setFromUnitVectors(UP, dir.normalize());
  const mid = new Vector3(...from).add(new Vector3(...to)).multiplyScalar(0.5);
  return (
    <mesh position={mid} quaternion={quaternion} castShadow receiveShadow>
      <cylinderGeometry args={[radius * taper, radius, length, 10]} />
      <FinishMaterial colour={colour} finish={finish} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

/**
 * Tags pick the version: "round" is the two-tier round coffee table,
 * "folding" the low laptop/bed table, "study" the study table with metal
 * legs; anything else is a rectangular coffee table with a shelf below.
 */
function Table({ product }: Props) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [top, frame = "#1a1a1c"] = product.palette;
  const t = Math.min(0.03, h * 0.08);
  const tags = product.tags;

  if (tags.includes("round")) {
    const r = Math.min(w, d) / 2;
    return (
      <group>
        <mesh position={[0, h - t / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[r, r, t, 48]} />
          <FinishMaterial colour={top} finish="wood" />
        </mesh>
        <mesh position={[0, h * 0.22, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[r * 0.86, r * 0.86, t * 0.8, 40]} />
          <FinishMaterial colour={top} finish="wood" />
        </mesh>
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          const lr = r * 0.8;
          return (
            <Leg
              key={i}
              position={[Math.cos(a) * lr, (h - t) / 2, Math.sin(a) * lr]}
              height={h - t}
              top={0.012}
              bottom={0.01}
              colour={frame}
              finish="metal"
            />
          );
        })}
      </group>
    );
  }

  if (tags.includes("folding")) {
    // A laptop table for the bed: a board with a raised back lip on two
    // fold-out U-shaped metal legs.
    const legH = h - t;
    return (
      <group>
        <Slab args={[w, t, d]} position={[0, h - t / 2, 0]} colour={top} finish="wood" radius={0.008} />
        <Slab args={[w * 0.98, 0.02, 0.012]} position={[0, h + 0.01, -d / 2 + 0.008]} colour={top} finish="wood" radius={0.004} />
        {([-1, 1] as const).map((s) => (
          <group key={s} position={[s * (w / 2 - 0.05), 0, 0]}>
            {([-1, 1] as const).map((z) => (
              <Leg key={z} position={[0, legH / 2, z * d * 0.38]} height={legH} top={0.008} bottom={0.008} colour={frame} finish="metal" />
            ))}
            <mesh position={[0, 0.008, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.008, 0.008, d * 0.76, 8]} />
              <FinishMaterial colour={frame} finish="metal" />
            </mesh>
          </group>
        ))}
      </group>
    );
  }

  const legW = 0.035;
  const ix = w / 2 - legW / 2 - 0.02;
  const iz = d / 2 - legW / 2 - 0.02;
  const study = tags.includes("study");
  return (
    <group>
      <Slab args={[w, t, d]} position={[0, h - t / 2, 0]} colour={top} finish="wood" radius={0.006} />
      {[
        [-ix, -iz],
        [ix, -iz],
        [-ix, iz],
        [ix, iz],
      ].map(([x, z], i) => (
        <Slab key={i} args={[legW, h - t, legW]} position={[x, (h - t) / 2, z]} colour={frame} finish="metal" radius={0.004} />
      ))}
      {study ? (
        <>
          {/* Back rail and side stretchers keep a study table from racking */}
          <Slab args={[w - legW * 2, 0.06, 0.018]} position={[0, h - t - 0.05, -iz]} colour={frame} finish="metal" radius={0.003} />
          {([-1, 1] as const).map((s) => (
            <Slab key={s} args={[0.02, 0.02, d - 0.08]} position={[s * ix, 0.12, 0]} colour={frame} finish="metal" radius={0.003} />
          ))}
          {/* Under-top shelf for books, the feature every listing shows */}
          <Slab args={[w * 0.5, 0.015, d * 0.7]} position={[w * 0.2, h - t - 0.15, -d * 0.1]} colour={top} finish="wood" radius={0.003} />
        </>
      ) : (
        <Slab args={[w - 0.06, t * 0.8, d - 0.06]} position={[0, h * 0.18, 0]} colour={top} finish="wood" radius={0.005} />
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Chairs                                                              */
/* ------------------------------------------------------------------ */

/** The moulded shell of an "Eames-style" chair, as one bent piece. */
function useShellGeometry(w: number, h: number, d: number, seatH: number) {
  return React.useMemo(() => {
    // Centre line of the shell from the seat front up the back, as
    // (backwards, up) pairs; it is thickened along its normal and extruded
    // across the width.
    const front = -d * 0.42;
    const back = d * 0.3;
    const line: [number, number][] = [];
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      if (u < 0.55) {
        const s = u / 0.55;
        // Seat, with a waterfall front edge and a gentle dish.
        const b = front + (back - front) * s;
        const y = seatH - Math.sin(s * Math.PI) * 0.015 - Math.max(0, 0.12 - s) * 0.25;
        line.push([b, y]);
      } else {
        const s = (u - 0.55) / 0.45;
        const a = s * (Math.PI / 2 - 0.2);
        const r = 0.08;
        // Curve up into the back, which leans slightly back.
        const b = back + Math.sin(a) * r + s * s * (d * 0.12);
        const y = seatH + (1 - Math.cos(a)) * r + s * (h - seatH - r);
        line.push([b, y]);
      }
    }
    const thick = 0.012;
    const outline = new Shape();
    const offset: Vector2[] = [];
    line.forEach(([b, y], i) => {
      const [pb, py] = line[Math.max(0, i - 1)];
      const [nb, ny] = line[Math.min(line.length - 1, i + 1)];
      const tx = nb - pb;
      const ty = ny - py;
      const len = Math.hypot(tx, ty) || 1;
      offset.push(new Vector2(b + (ty / len) * thick, y - (tx / len) * thick));
    });
    outline.moveTo(line[0][0], line[0][1]);
    for (const [b, y] of line.slice(1)) outline.lineTo(b, y);
    for (const p of offset.reverse()) outline.lineTo(p.x, p.y);
    outline.closePath();
    const width = w * 0.92;
    const g = new ExtrudeGeometry(outline, {
      depth: width,
      bevelEnabled: true,
      bevelThickness: 0.006,
      bevelSize: 0.005,
      bevelSegments: 2,
      curveSegments: 4,
    });
    g.translate(0, 0, -width / 2);
    g.computeVertexNormals();
    return g;
  }, [w, h, d, seatH]);
}

function MouldedChair({ product }: Props) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [shell, legs = "#c49a6c", wire = "#1a1a1c"] = product.palette;
  const seatH = Math.min(0.46, h * 0.55);
  const geometry = useShellGeometry(w, h, d, seatH);
  const top = seatH - 0.035;
  // Splayed wooden legs from under the seat to just inside the footprint.
  const legs4: [Vec3, Vec3][] = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => [
      [sx * w * 0.24, top, sz * d * 0.2] as Vec3,
      [sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.04)] as Vec3,
    ]),
  );

  return (
    <group>
      {/* The extrusion runs along x after this turn; its profile's
          "backwards" axis becomes -z, so the seat front faces +z. */}
      <mesh geometry={geometry} rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow>
        <FinishMaterial colour={shell} finish="plastic" roughness={0.42} />
      </mesh>
      {legs4.map(([a, b], i) => (
        <Strut key={i} from={a} to={b} radius={0.016} taper={0.7} colour={legs} finish="wood" />
      ))}
      {/* The black wire cradle between the legs */}
      {legs4.map(([a, b], i) => {
        const mid: Vec3 = [(a[0] + b[0]) * 0.45, top * 0.42, (a[2] + b[2]) * 0.45];
        return <Strut key={`w${i}`} from={[a[0] * 0.6, top, a[2] * 0.6]} to={mid} radius={0.004} colour={wire} finish="metal" />;
      })}
      <Strut from={[-w * 0.2, top * 0.42, 0]} to={[w * 0.2, top * 0.42, 0]} radius={0.004} colour={wire} finish="metal" />
    </group>
  );
}

function GamingChair({ product }: Props) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, accent = "#e0263a", base = "#141416"] = product.palette;
  const seatH = 0.5;
  const seatT = 0.09;
  const backH = h - seatH - 0.02;
  const backW = w * 0.72;

  return (
    <group>
      {/* Five-star base on castors and a gas lift */}
      {Array.from({ length: 5 }).map((_, i) => {
        const a = (i / 5) * Math.PI * 2;
        const r = Math.min(w, d) * 0.46;
        return (
          <group key={i} rotation={[0, a, 0]}>
            <Slab args={[0.035, 0.03, r]} position={[0, 0.07, r / 2]} colour={base} finish="plastic" radius={0.01} />
            <mesh position={[0, 0.03, r]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.03, 0.03, 0.025, 14]} />
              <meshStandardMaterial color="#0e0e10" roughness={0.6} />
            </mesh>
          </group>
        );
      })}
      <Leg position={[0, 0.08 + (seatH - 0.18) / 2, 0]} height={seatH - 0.18} top={0.024} bottom={0.03} colour="#8a8a90" finish="metal" />

      {/* Bucket seat with raised side bolsters */}
      <Slab args={[w * 0.62, seatT, d * 0.72]} position={[0, seatH - seatT / 2, 0.02]} colour={body} finish="fabric" radius={0.035} />
      {([-1, 1] as const).map((s) => (
        <Slab
          key={`b${s}`}
          args={[w * 0.09, seatT * 1.1, d * 0.7]}
          position={[s * w * 0.33, seatH - seatT * 0.25, 0.02]}
          rotation={[0, 0, s * -0.25]}
          colour={accent}
          finish="fabric"
          radius={0.03}
        />
      ))}

      {/* Tall racing back, reclined, with wings, stripes and a head pillow */}
      <group position={[0, seatH, -d * 0.32]} rotation={[-0.12, 0, 0]}>
        <Slab args={[backW, backH, 0.1]} position={[0, backH / 2, 0]} colour={body} finish="fabric" radius={0.04} />
        {([-1, 1] as const).map((s) => (
          <React.Fragment key={s}>
            <Slab
              args={[w * 0.1, backH * 0.6, 0.12]}
              position={[s * (backW / 2 + w * 0.02), backH * 0.38, 0.02]}
              rotation={[0, s * -0.35, 0]}
              colour={accent}
              finish="fabric"
              radius={0.035}
            />
            <Slab
              args={[0.03, backH * 0.75, 0.012]}
              position={[s * backW * 0.24, backH * 0.5, 0.052]}
              colour={accent}
              finish="fabric"
              radius={0.005}
            />
          </React.Fragment>
        ))}
        {/* Headrest cut-outs either side of the top, as on every racing chair */}
        <Slab args={[backW * 0.55, backH * 0.14, 0.1]} position={[0, backH * 0.95, 0]} colour={body} finish="fabric" radius={0.035} />
        <Slab args={[backW * 0.45, 0.11, 0.08]} position={[0, backH * 0.8, 0.07]} colour={base} finish="fabric" radius={0.04} />
        <Slab args={[backW * 0.5, 0.12, 0.07]} position={[0, backH * 0.2, 0.07]} colour={base} finish="fabric" radius={0.04} />
      </group>

      {/* Armrests */}
      {([-1, 1] as const).map((s) => (
        <group key={`a${s}`} position={[s * w * 0.42, seatH - 0.04, -d * 0.02]}>
          <Slab args={[0.035, 0.24, 0.05]} position={[0, 0.12, 0]} colour={base} finish="plastic" radius={0.01} />
          <Slab args={[0.08, 0.03, d * 0.4]} position={[0, 0.25, 0.02]} colour={base} finish="plastic" radius={0.012} />
        </group>
      ))}
    </group>
  );
}

/** Velvet tub chair on tapered gold legs. */
function AccentChair({ product }: Props) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [velvet, legs = "#c9a24a"] = product.palette;
  const legH = 0.17;
  const seatTop = 0.44;
  const r = Math.min(w, d) / 2;
  const backH = h - legH;

  return (
    <group>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <Strut
            key={`${sx}${sz}`}
            from={[sx * r * 0.6, legH, sz * r * 0.6]}
            to={[sx * r * 0.74, 0, sz * r * 0.74]}
            radius={0.016}
            taper={0.55}
            colour={legs}
            finish="metal"
          />
        )),
      )}
      {/* Base and seat cushion */}
      <mesh position={[0, legH + (seatTop - legH - 0.08) / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r * 0.9, r * 0.84, seatTop - legH - 0.08, 40]} />
        <FinishMaterial colour={velvet} finish="fabric" roughness={0.8} />
      </mesh>
      <mesh position={[0, seatTop - 0.05, r * 0.06]} scale={[1, 0.4, 0.95]} castShadow receiveShadow>
        <sphereGeometry args={[r * 0.8, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <FinishMaterial colour={velvet} finish="fabric" roughness={0.8} />
      </mesh>
      <mesh position={[0, seatTop - 0.08, r * 0.06]} castShadow receiveShadow>
        <cylinderGeometry args={[r * 0.8, r * 0.8, 0.06, 40]} />
        <FinishMaterial colour={velvet} finish="fabric" roughness={0.8} />
      </mesh>
      {/* Curved back wrapping round into arms: a thick open shell */}
      <group position={[0, legH, 0]}>
        <mesh position={[0, backH * 0.5, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[r * 0.98, r * 0.92, backH, 40, 1, true, Math.PI * 0.35, Math.PI * 1.3]} />
          <FinishMaterial colour={velvet} finish="fabric" roughness={0.8} />
        </mesh>
        <mesh position={[0, backH * 0.5, 0]}>
          <cylinderGeometry args={[r * 0.84, r * 0.8, backH, 40, 1, true, Math.PI * 0.35, Math.PI * 1.3]} />
          <meshStandardMaterial color={velvet} roughness={0.85} side={DoubleSide} />
        </mesh>
        {/* Rounded fronts where the back curls into arms */}
        {[0.35, 1.65].map((a) => (
          <mesh key={a} position={[Math.sin(a * Math.PI) * r * 0.89, backH * 0.5, Math.cos(a * Math.PI) * r * 0.89]} castShadow>
            <cylinderGeometry args={[r * 0.075, r * 0.075, backH, 14]} />
            <FinishMaterial colour={velvet} finish="fabric" roughness={0.8} />
          </mesh>
        ))}
        {/* Rolled top edge */}
        <mesh position={[0, backH, 0]} rotation={[Math.PI / 2, 0, -Math.PI * 1.15]}>
          <torusGeometry args={[r * 0.91, r * 0.075, 10, 40, Math.PI * 1.3]} />
          <FinishMaterial colour={velvet} finish="fabric" roughness={0.8} />
        </mesh>
      </group>
    </group>
  );
}

function Chair(props: Props) {
  const tags = props.product.tags;
  if (tags.includes("gaming")) return <GamingChair {...props} />;
  if (tags.includes("velvet")) return <AccentChair {...props} />;
  return <MouldedChair {...props} />;
}

/* ------------------------------------------------------------------ */
/* Curtains                                                            */
/* ------------------------------------------------------------------ */

/**
 * A pair of pleated curtains on a rod, drawn open either side of a window.
 * The folds deepen towards the hem, where the cloth is free to swing, and a
 * "sheer" pair lets the light through.
 */
function Curtains({ product }: Props) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [cloth, rod = "#1a1a1c"] = product.palette;
  const sheer = product.tags.includes("sheer");
  const rodY = h / 2 - 0.03;
  const rodZ = d * 0.65;
  const panelW = w * 0.28;
  const panelH = h - 0.07;

  const geometry = React.useMemo(() => {
    const g = new PlaneGeometry(panelW, panelH, 72, 10);
    const p = g.attributes.position;
    const folds = 7;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const fromTop = (panelH / 2 - y) / panelH;
      const amp = d * (0.22 + 0.16 * fromTop);
      p.setZ(i, Math.sin(((x + panelW / 2) / panelW) * folds * Math.PI * 2) * amp);
    }
    g.computeVertexNormals();
    return g;
  }, [panelW, panelH, d]);

  const material = sheer ? (
    <meshStandardMaterial color={cloth} roughness={0.9} transparent opacity={0.55} side={DoubleSide} depthWrite={false} />
  ) : (
    // The weave map already carries the colour; tinting it again would square it darker.
    <meshStandardMaterial color="#ffffff" map={weaveTexture(cloth, "#000000", `curtain:${product.id}`)} roughness={0.95} side={DoubleSide} />
  );

  return (
    <group>
      <mesh position={[0, rodY, rodZ]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.012, 0.012, w, 14]} />
        <FinishMaterial colour={rod} finish="metal" />
      </mesh>
      {([-1, 1] as const).map((s) => (
        <React.Fragment key={s}>
          <mesh position={[s * (w / 2 + 0.015), rodY, rodZ]} castShadow>
            <sphereGeometry args={[0.025, 16, 12]} />
            <FinishMaterial colour={rod} finish="metal" />
          </mesh>
          {/* Wall bracket */}
          <Slab args={[0.02, 0.05, rodZ]} position={[s * (w / 2 - 0.08), rodY, rodZ / 2]} colour={rod} finish="metal" radius={0.004} />
          <mesh geometry={geometry} position={[s * (w / 2 - panelW / 2 - 0.02), rodY - 0.03 - panelH / 2, rodZ - d * 0.15]} castShadow={!sheer} receiveShadow>
            {material}
          </mesh>
          {/* Eyelet rings along the rod */}
          {Array.from({ length: 7 }).map((_, i) => (
            <mesh
              key={i}
              position={[s * (w / 2 - 0.02 - panelW * (i / 6)), rodY, rodZ]}
              rotation={[0, Math.PI / 2, 0]}
            >
              <torusGeometry args={[0.02, 0.003, 6, 16]} />
              <FinishMaterial colour={rod} finish="metal" />
            </mesh>
          ))}
        </React.Fragment>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Fabric wall hangings                                                */
/* ------------------------------------------------------------------ */

const canvases = new Map<string, Texture>();

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  const hit = canvases.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  canvases.set(key, tex);
  return tex;
}

/** Key art of an anime wall scroll: a character against a big sky. */
function scrollArt(product: Product): Texture {
  const [sky, accent = "#ff8fb1", ink = "#1b1830", cream = "#f6efe2"] = product.palette;
  const W = 300;
  const H = Math.round((W * product.dims.h) / product.dims.w);
  return canvasTexture(`scroll:${product.id}`, W, H, (ctx) => {
    const rnd = seededRandom(product.id);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, sky);
    g.addColorStop(0.7, accent);
    g.addColorStop(1, cream);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Sun and drifting petals
    ctx.fillStyle = cream;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(W * 0.7, H * 0.28, W * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = accent;
    for (let i = 0; i < 40; i++) {
      ctx.globalAlpha = 0.4 + rnd() * 0.5;
      ctx.beginPath();
      ctx.ellipse(rnd() * W, rnd() * H, 3 + rnd() * 4, 2 + rnd() * 2, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The character: hair, face, shoulders — a silhouette with a lit face.
    const cx = W * 0.45;
    const cy = H * 0.55;
    const r = W * 0.2;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.moveTo(cx - r * 2.2, H);
    ctx.quadraticCurveTo(cx - r * 1.6, cy + r * 1.3, cx, cy + r * 1.1);
    ctx.quadraticCurveTo(cx + r * 1.6, cy + r * 1.3, cx + r * 2.2, H);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.1, r * 1.25, Math.PI, 0);
    ctx.lineTo(cx + r * 1.35, cy + r * 1.4);
    ctx.lineTo(cx + r * 0.9, cy + r * 0.6);
    ctx.lineTo(cx - r * 0.9, cy + r * 0.6);
    ctx.lineTo(cx - r * 1.35, cy + r * 1.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = cream;
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.25, r * 0.78, r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    // Bangs over the forehead
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.95, cy - r * 0.2);
    for (let i = 0; i <= 6; i++) {
      const x = cx - r * 0.95 + (i / 6) * r * 1.9;
      ctx.lineTo(x, cy + (i % 2 ? r * 0.3 : -r * 0.05));
    }
    ctx.lineTo(cx + r * 0.95, cy - r * 0.6);
    ctx.lineTo(cx - r * 0.95, cy - r * 0.6);
    ctx.fill();
    // Big anime eyes
    for (const s of [-1, 1]) {
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.ellipse(cx + s * r * 0.33, cy + r * 0.45, r * 0.13, r * 0.19, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(cx + s * r * 0.33 - r * 0.04, cy + r * 0.38, r * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
    // Title bar down the side, in the scroll's style
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(W * 0.06, H * 0.06, W * 0.1, H * 0.42);
    ctx.fillStyle = cream;
    for (let i = 0; i < 6; i++) ctx.fillRect(W * 0.08, H * (0.08 + i * 0.065), W * 0.06, H * 0.04);
    ctx.globalAlpha = 1;
  });
}

/** A hanging fabric scroll (kakemono): printed cloth between two dowels on a cord. */
function WallScroll({ product }: Props) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const [, , , , rodColour = "#2a1a10"] = product.palette;
  const top = h / 2 - h * 0.09;
  const bottom = -h / 2 + 0.012;
  const clothH = top - bottom;
  const tex = React.useMemo(() => scrollArt(product), [product]);
  const geometry = React.useMemo(() => {
    const g = new PlaneGeometry(w * 0.92, clothH, 12, 12);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      // A slight belly away from the wall, as cloth hangs.
      p.setZ(i, Math.cos((x / w) * Math.PI) * 0.006);
    }
    g.computeVertexNormals();
    return g;
  }, [w, clothH]);

  return (
    <group position={[0, 0, 0.012]}>
      <mesh geometry={geometry} position={[0, (top + bottom) / 2, 0]} castShadow receiveShadow>
        <meshStandardMaterial map={tex} roughness={0.92} side={DoubleSide} />
      </mesh>
      {[top, bottom].map((y, i) => (
        <group key={i} position={[0, y, 0.004]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.008, 0.008, w, 12]} />
            <FinishMaterial colour={rodColour} finish="wood" />
          </mesh>
          {([-1, 1] as const).map((s) => (
            <mesh key={s} position={[s * (w / 2), 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.012, 0.012, 0.012, 12]} />
              <FinishMaterial colour="#c9a24a" finish="metal" />
            </mesh>
          ))}
        </group>
      ))}
      {/* Hanging cord up to the hook */}
      {([-1, 1] as const).map((s) => (
        <Strut key={s} from={[s * w * 0.42, top, 0.004]} to={[0, h / 2 - 0.004, 0]} radius={0.0015} colour="#2a2a2a" finish="fabric" />
      ))}
    </group>
  );
}

/** A boho macramé hanging: knotted cotton cord on a driftwood dowel. */
function Macrame({ product }: Props) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const [cord, wood = "#a57a52"] = product.palette;
  const tex = React.useMemo(
    () =>
      canvasTexture(`macrame:${product.id}`, 256, Math.round((256 * product.dims.h) / product.dims.w), (ctx) => {
        const W = ctx.canvas.width;
        const H = ctx.canvas.height;
        ctx.clearRect(0, 0, W, H);
        ctx.strokeStyle = cord;
        ctx.fillStyle = cord;
        ctx.lineCap = "round";
        const n = 16;
        const xs = Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * W);
        // Cords hanging straight, gathered into rows of square knots that
        // step in to a diamond, then a long V-cut fringe.
        const knotRows = 9;
        const bodyEnd = H * 0.62;
        ctx.lineWidth = W / n / 2.6;
        for (const x of xs) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, bodyEnd);
          ctx.stroke();
        }
        for (let r = 0; r < knotRows; r++) {
          const y = H * 0.06 + (r / knotRows) * (bodyEnd - H * 0.08);
          const inset = Math.abs(r - (knotRows - 1) / 2) < 2 ? 2 : 0;
          for (let i = (r % 2) + inset; i < n - 1 - inset; i += 2) {
            ctx.beginPath();
            ctx.ellipse((xs[i] + xs[i + 1]) / 2, y, W / n, H * 0.018, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.lineWidth = W / n / 3.2;
        for (const x of xs) {
          const len = H * 0.98 - Math.abs(x - W / 2) * (H * 0.32) / (W / 2);
          ctx.beginPath();
          ctx.moveTo(x, bodyEnd);
          ctx.lineTo(x + (x - W / 2) * 0.04, len);
          ctx.stroke();
        }
      }),
    [product, cord],
  );

  return (
    <group position={[0, 0, 0.02]}>
      <mesh position={[0, -0.02, 0]} castShadow>
        <planeGeometry args={[w * 0.86, h - 0.03]} />
        <meshStandardMaterial map={tex} alphaTest={0.4} roughness={1} side={DoubleSide} />
      </mesh>
      <mesh position={[0, h / 2 - 0.02, 0.004]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.011, 0.012, w, 12]} />
        <FinishMaterial colour={wood} finish="wood" />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Soft furnishings                                                    */
/* ------------------------------------------------------------------ */

/** A plump square cushion: a sphere pushed out to its corners. */
function useCushionGeometry() {
  return React.useMemo(() => {
    const g = new SphereGeometry(1, 36, 28);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const sx = Math.sign(x) * Math.pow(Math.abs(x), 0.32);
      const sy = Math.sign(y) * Math.pow(Math.abs(y), 0.32);
      // Thinner towards the seams, fullest in the middle.
      const fill = 1 - 0.55 * Math.max(sx * sx, sy * sy);
      p.setXYZ(i, sx, sy, z * fill);
    }
    g.computeVertexNormals();
    return g;
  }, []);
}

/** A pair of throw cushions, propped up and leaning back a little. */
function Cushions({ product }: Props) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const geometry = useCushionGeometry();
  const [a, b = a] = product.palette;
  const size = Math.min(h, w / 2.1);
  return (
    <group>
      {[a, b].map((colour, i) => (
        <mesh
          key={i}
          geometry={geometry}
          position={[(i ? 1 : -1) * w * 0.24, size / 2, i ? d * 0.12 : 0]}
          rotation={[-0.22, (i ? -1 : 1) * 0.12, (i ? 1 : -1) * 0.05]}
          scale={[size / 2, size / 2, d * 0.45]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color="#ffffff" map={weaveTexture(colour, "#000000", `cushion:${product.id}:${i}`)} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

/** A chunky knitted pouf. */
function Pouf({ product }: Props) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [colour, accent = colour] = product.palette;
  const geometry = React.useMemo(() => {
    const g = new SphereGeometry(1, 40, 24);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const r = Math.hypot(p.getX(i), p.getZ(i));
      const ny = Math.sign(y) * Math.pow(Math.abs(y), 0.28);
      const nr = r > 1e-6 ? Math.pow(r, 0.4) / r : 0;
      p.setXYZ(i, p.getX(i) * nr, ny, p.getZ(i) * nr);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const tex = React.useMemo(() => {
    const t = weaveTexture(colour, accent, `pouf:${product.id}`).clone();
    t.repeat.set(10, 3);
    t.needsUpdate = true;
    return t;
  }, [colour, accent, product.id]);
  return (
    <mesh geometry={geometry} position={[0, h / 2, 0]} scale={[w / 2, h / 2, d / 2]} castShadow receiveShadow>
      <meshStandardMaterial color="#ffffff" map={tex} roughness={1} />
    </mesh>
  );
}

/** A woven seagrass basket with rope handles — plant cover or storage. */
function Basket({ product }: Props) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const [colour, accent = colour] = product.palette;
  const r = w / 2;
  const tex = React.useMemo(() => {
    const t = weaveTexture(colour, accent, `basket:${product.id}`).clone();
    t.repeat.set(14, 6);
    t.needsUpdate = true;
    return t;
  }, [colour, accent, product.id]);
  const geometry = React.useMemo(
    () =>
      new LatheGeometry(
        [
          new Vector2(0.001, 0),
          new Vector2(r * 0.82, 0),
          new Vector2(r * 0.93, h * 0.25),
          new Vector2(r, h * 0.7),
          new Vector2(r * 0.98, h),
          new Vector2(r * 0.92, h),
          new Vector2(r * 0.9, h * 0.2),
          new Vector2(r * 0.001, h * 0.04),
        ],
        40,
      ),
    [r, h],
  );
  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color="#ffffff" map={tex} roughness={1} side={DoubleSide} />
      </mesh>
      <mesh position={[0, h, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r * 0.95, 0.008, 8, 40]} />
        <FinishMaterial colour={accent} finish="fabric" />
      </mesh>
      {([-1, 1] as const).map((s) => (
        <mesh key={s} position={[s * r * 0.97, h * 0.82, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.035, 0.007, 8, 16, Math.PI]} />
          <FinishMaterial colour={accent} finish="fabric" />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Lamps                                                               */
/* ------------------------------------------------------------------ */

function LampShade({
  product,
  radiusTop,
  radiusBottom,
  height,
  y,
  light,
  lightScale = 1,
}: Props & { radiusTop: number; radiusBottom: number; height: number; y: number }) {
  const [shade] = product.palette;
  const glow = product.emissive?.color ?? "#ffd9a0";
  return (
    <group position={[0, y, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[radiusTop, radiusBottom, height, 40, 1, true]} />
        <meshStandardMaterial color={shade} emissive={glow} emissiveIntensity={0.45} roughness={0.9} side={DoubleSide} />
      </mesh>
      {/* The bright opening underneath */}
      <mesh position={[0, -height / 2 + 0.002, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radiusBottom * 0.97, 32]} />
        <meshBasicMaterial color={glow} toneMapped={false} transparent opacity={0.85} side={DoubleSide} />
      </mesh>
      <mesh position={[0, -height * 0.1, 0]}>
        <sphereGeometry args={[Math.min(radiusTop, 0.03), 14, 10]} />
        <meshBasicMaterial color={glow} toneMapped={false} />
      </mesh>
      {light && product.emissive ? (
        <pointLight
          position={[0, -height * 0.2, 0]}
          color={glow}
          intensity={product.emissive.lightIntensity * lightScale}
          distance={product.emissive.distance}
          decay={2}
          castShadow
        />
      ) : null}
    </group>
  );
}

/** Tripod floor lamp: three wooden legs and a drum shade. */
function FloorLamp(props: Props) {
  const { product } = props;
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const [, wood = "#8a5a34"] = product.palette;
  const shadeH = h * 0.2;
  const apex = h * 0.66;
  const spread = w * 0.42;
  return (
    <group>
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
        return (
          <Strut
            key={i}
            from={[Math.cos(a) * spread, 0, Math.sin(a) * spread]}
            to={[0, apex, 0]}
            radius={0.014}
            taper={0.7}
            colour={wood}
            finish="wood"
          />
        );
      })}
      <mesh position={[0, apex - 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.02, 0.022, 0.06, 12]} />
        <FinishMaterial colour="#c9a24a" finish="metal" />
      </mesh>
      <Strut from={[0, apex, 0]} to={[0, h - shadeH * 0.6, 0]} radius={0.007} colour="#c9a24a" finish="metal" />
      <LampShade {...props} radiusTop={w * 0.36} radiusBottom={w * 0.4} height={shadeH} y={h - shadeH / 2} />
    </group>
  );
}

/** Bedside table lamp: a ceramic gourd base under a tapered drum shade. */
function TableLamp(props: Props) {
  const { product } = props;
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const [, base = "#c86f4a"] = product.palette;
  const shadeH = h * 0.36;
  const baseH = h * 0.5;
  const r = w / 2;
  const geometry = React.useMemo(
    () =>
      new LatheGeometry(
        [
          [0.001, 0],
          [r * 0.42, 0],
          [r * 0.46, baseH * 0.08],
          [r * 0.62, baseH * 0.38],
          [r * 0.58, baseH * 0.62],
          [r * 0.3, baseH * 0.88],
          [r * 0.12, baseH],
          [0.001, baseH],
        ].map(([x, y]) => new Vector2(x, y)),
        36,
      ),
    [r, baseH],
  );
  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshPhysicalMaterial color={base} roughness={0.25} clearcoat={0.8} />
      </mesh>
      <Strut from={[0, baseH, 0]} to={[0, h - shadeH * 0.5, 0]} radius={0.006} colour="#c9a24a" finish="metal" />
      <LampShade {...props} radiusTop={r * 0.68} radiusBottom={r * 0.98} height={shadeH} y={h - shadeH / 2} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Floor mirror                                                        */
/* ------------------------------------------------------------------ */

/** A full-length mirror leaning on the wall; its glass reflects the room. */
function FloorMirror({ product }: Props) {
  const [frame, dark = "#1a1a1c", light = "#f2f0eb"] = product.palette;
  const shape = product.tags.includes("arch") ? "arch" : product.tags.includes("rounded") ? "rounded" : "rect";
  return <TemplateModel product={product} template={{ kind: "mirror", colours: [frame, dark, light], shape }} />;
}

export const DECOR_MODELS: Record<string, React.ComponentType<Props>> = {
  table: Table,
  accentChair: Chair,
  curtains: Curtains,
  wallScroll: WallScroll,
  macrame: Macrame,
  cushions: Cushions,
  pouf: Pouf,
  basket: Basket,
  floorLamp: FloorLamp,
  tableLamp: TableLamp,
  floorMirror: FloorMirror,
};
