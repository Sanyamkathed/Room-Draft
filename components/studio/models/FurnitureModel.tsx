"use client";

import * as React from "react";
import { DoubleSide, type Texture } from "three";
import type { Product } from "@/lib/catalog/types";
import {
  BarPull,
  type BoxPart,
  DrawerFront,
  FinishMaterial,
  Leg,
  MergedBoxes,
  Slab,
  useSeeded,
} from "./finish";
import { M } from "./shapes";

/**
 * The furniture already in the room.
 *
 * Their first job is to occupy the right VOLUME so decor collides with them
 * and rests on them. Their second is to look like furniture: a lamp on a grey
 * box reads as a mock-up, a lamp on a desk with a drawer pedestal and a grained
 * top reads as a room. So edges are softened, timber gets grain, upholstery
 * gets weave, and each piece carries the one or two details — drawer gaps,
 * door panels, a tufted headboard — that name it at a glance.
 *
 * Everything is authored to its product dimensions, where height is the
 * SURFACE height: a bed is 50cm because that is where a book would land. Parts
 * that rise above that — a headboard, a chair back — are drawn beyond the box
 * deliberately, so stacking stays where a human would put things down.
 */

export interface FurnitureProps {
  product: Product;
  /** Photo region traced over this object's front face, if any. */
  traceTexture?: Texture | null;
  light?: boolean;
}

/**
 * The traced photo region, laid over the front face.
 *
 * This is what makes a traced wardrobe look like *their* wardrobe: the box is
 * generic, but its face is a crop of the wall photo they took.
 */
function TraceFace({
  width,
  height,
  z,
  texture,
}: {
  width: number;
  height: number;
  z: number;
  texture?: Texture | null;
}) {
  if (!texture) return null;
  return (
    <mesh position={[0, height / 2, z]}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial map={texture} roughness={0.82} metalness={0} />
    </mesh>
  );
}

function Panel({
  args,
  position,
  colour,
  rough = 0.68,
}: {
  args: [number, number, number];
  position: [number, number, number];
  colour: string;
  rough?: number;
}) {
  return (
    <Slab args={args} position={position} colour={colour} roughness={rough} radius={0.005} />
  );
}

/* ------------------------------------------------------------------ */

function Bed({ product, traceTexture }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [linen, frame] = product.palette;

  const legH = 0.08;
  const railH = h * 0.36;
  const railTop = legH + railH;
  const mattressH = h - railTop + 0.02;
  const tufts = Math.max(3, Math.round(w / 0.3));

  return (
    <group>
      {/* Frame: legs, side rails and a footboard lip */}
      {([-1, 1] as const).map((sx) =>
        ([-1, 1] as const).map((sz) => (
          <Leg
            key={`${sx}${sz}`}
            position={[sx * (w / 2 - 0.05), legH / 2, sz * (d / 2 - 0.05)]}
            height={legH}
            top={0.022}
            bottom={0.016}
            colour={frame}
          />
        )),
      )}
      <Slab args={[w, railH, d]} position={[0, legH + railH / 2, 0]} colour={frame} radius={0.012} />

      {/* Mattress with a soft, rounded edge */}
      <Slab
        args={[w * 0.97, mattressH, d * 0.97]}
        position={[0, railTop + mattressH / 2 - 0.02, 0.005]}
        colour="#f1ede6"
        finish="fabric"
        radius={0.04}
      />

      {/* Duvet draped over the lower two-thirds, folded back at the top */}
      <Slab
        args={[w * 1.0, 0.045, d * 0.64]}
        position={[0, h + 0.008, d * 0.17]}
        colour={linen}
        finish="fabric"
        radius={0.02}
      />
      <Slab
        args={[w * 1.0, 0.05, 0.12]}
        position={[0, h + 0.014, -d * 0.13]}
        colour={linen}
        finish="fabric"
        radius={0.024}
      />
      {/* Duvet hangs a little over each side */}
      {([-1, 1] as const).map((s) => (
        <Slab
          key={s}
          args={[0.025, mattressH * 0.8, d * 0.64]}
          position={[s * (w / 2 + 0.006), h - mattressH * 0.35, d * 0.17]}
          colour={linen}
          finish="fabric"
          radius={0.01}
        />
      ))}

      {/* Pillows: soft, slightly squashed */}
      {(w > M(110) ? [-1, 1] : [0]).map((s) => (
        <mesh
          key={s}
          position={[s * w * 0.23, h + 0.05, -d * 0.39]}
          scale={[w > M(110) ? w * 0.4 : w * 0.7, 0.11, d * 0.13]}
          castShadow
          receiveShadow
        >
          <sphereGeometry args={[0.5, 24, 14]} />
          <FinishMaterial colour="#f6f3ee" finish="fabric" />
        </mesh>
      ))}

      {/* Upholstered, tufted headboard — rises past the box on purpose */}
      <Slab
        args={[w + 0.04, h * 1.55, 0.07]}
        position={[0, h * 0.78, -d / 2 - 0.03]}
        colour={frame}
        radius={0.03}
      />
      {Array.from({ length: tufts }).map((_, i) => (
        <mesh
          key={i}
          position={[(i - (tufts - 1) / 2) * (w / tufts), h * 1.2, -d / 2 + 0.006]}
        >
          <sphereGeometry args={[0.011, 8, 6]} />
          <meshStandardMaterial color={frame} roughness={0.5} />
        </mesh>
      ))}

      <TraceFace width={w} height={h} z={d / 2 + 0.004} texture={traceTexture} />
    </group>
  );
}

function Desk({ product, traceTexture }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [top, leg] = product.palette;
  const slab = 0.03;
  const legW = 0.04;
  const legC = leg ?? top;
  const pedestal = w >= 1.0;
  const pedW = Math.min(0.42, w * 0.32);

  return (
    <group>
      {/* Top: rounded edges, grain where the colour is timber */}
      <Slab args={[w, slab, d]} position={[0, h - slab / 2, 0]} colour={top} radius={0.008} />

      {/* Apron rails under the top */}
      <Slab args={[w - legW * 2, 0.06, 0.018]} position={[0, h - slab - 0.03, -d / 2 + 0.03]} colour={legC} radius={0.004} />
      {([-1, 1] as const).map((s) => (
        <Slab
          key={`r${s}`}
          args={[0.018, 0.06, d - 0.08]}
          position={[s * (w / 2 - 0.035), h - slab - 0.03, 0]}
          colour={legC}
          radius={0.004}
        />
      ))}

      {/* Legs, slightly tapered */}
      {([-1, 1] as const).map((sx) =>
        ([-1, 1] as const).map((sz) =>
          pedestal && sx === 1 ? null : (
            <Slab
              key={`${sx}${sz}`}
              args={[legW, h - slab, legW]}
              position={[sx * (w / 2 - 0.035), (h - slab) / 2, sz * (d / 2 - 0.035)]}
              colour={legC}
              radius={0.008}
            />
          ),
        ),
      )}

      {/* Drawer pedestal on the right, the way most study desks are built */}
      {pedestal ? (
        <group position={[w / 2 - pedW / 2 - 0.01, 0, 0]}>
          <Slab args={[pedW, h - slab, d - 0.04]} position={[0, (h - slab) / 2, 0]} colour={top} radius={0.006} />
          {[0, 1, 2].map((i) => {
            const fh = (h - slab - 0.06) / 3 - 0.012;
            const y = 0.03 + fh / 2 + i * (fh + 0.012) + 0.006;
            return (
              <DrawerFront
                key={i}
                width={pedW - 0.03}
                height={fh}
                y={y}
                z={(d - 0.04) / 2}
                colour={legC}
              />
            );
          })}
        </group>
      ) : null}

      {/* Modesty panel — also stops you seeing straight through the desk */}
      <Slab args={[w * 0.86, h * 0.34, 0.016]} position={[pedestal ? -pedW / 2 : 0, h * 0.62, -d / 2 + 0.05]} colour={legC} radius={0.004} />

      <TraceFace width={w} height={h} z={d / 2 + 0.004} texture={traceTexture} />
    </group>
  );
}

function Wardrobe({ product, traceTexture }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, trim] = product.palette;
  const doorC = trim ?? body;
  const plinth = 0.07;
  const crown = 0.04;
  const doors = w > 1.3 ? 3 : 2;
  const doorW = (w - 0.03) / doors;
  const doorH = h - plinth - crown - 0.02;

  return (
    <group>
      <Slab args={[w - 0.02, plinth, d - 0.04]} position={[0, plinth / 2, -0.01]} colour={doorC} radius={0.004} />
      <Slab args={[w, h - plinth - crown, d - 0.02]} position={[0, plinth + (h - plinth - crown) / 2, -0.01]} colour={body} radius={0.008} />
      <Slab args={[w + 0.02, crown, d + 0.01]} position={[0, h - crown / 2, 0]} colour={body} radius={0.008} />

      {Array.from({ length: doors }).map((_, i) => {
        const x = -w / 2 + 0.015 + doorW * (i + 0.5);
        const cy = plinth + 0.01 + doorH / 2;
        return (
          <group key={i} position={[x, 0, d / 2 - 0.01]}>
            {/* Door leaf */}
            <Slab args={[doorW - 0.008, doorH, 0.02]} position={[0, cy, 0.01]} colour={doorC} radius={0.004} />
            {/* Raised inner panels, so the doors read as joinery */}
            {[0.27, 0.73].map((f, j) => (
              <Slab
                key={j}
                args={[doorW - 0.09, doorH * (j === 0 ? 0.42 : 0.42), 0.008]}
                position={[0, plinth + 0.01 + doorH * f, 0.024]}
                colour={doorC}
                radius={0.003}
              />
            ))}
            <BarPull
              position={[(i % 2 === 0 ? 1 : -1) * (doorW / 2 - 0.04), cy, 0.02]}
              length={0.22}
              vertical
            />
          </group>
        );
      })}

      <TraceFace width={w} height={h} z={d / 2 + 0.05} texture={traceTexture} />
    </group>
  );
}

function BookshelfTall({ product, traceTexture }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, trim] = product.palette;
  const t = 0.022;
  const shelves = Math.max(3, Math.round(h / 0.36));
  const rnd = useSeeded(product.id);

  const books = React.useMemo(() => {
    const spines = ["#6b2b2b", "#2a3a5a", "#c9a227", "#3f6b46", "#e8e2d4", "#4a3b5c", "#b8613a"];
    return Array.from({ length: shelves }).map(() => {
      const out: { x: number; bw: number; bh: number; c: string; lean: number }[] = [];
      let x = 0;
      const limit = (w - t * 2) * (0.45 + rnd() * 0.45);
      while (x < limit) {
        const bw = 0.018 + rnd() * 0.02;
        out.push({ x: x + bw / 2, bw, bh: 0.16 + rnd() * 0.09, c: spines[Math.floor(rnd() * spines.length)], lean: 0 });
        x += bw + 0.002;
      }
      if (out.length && rnd() < 0.5) out[out.length - 1].lean = 0.22;
      return out;
    });
  }, [shelves, w, rnd]);

  const bookParts = React.useMemo(() => {
    const out: { books: BoxPart[]; bands: BoxPart[] } = { books: [], bands: [] };
    books.forEach((row, i) => {
      const y = (i / shelves) * (h - t) + t;
      for (const b of row) {
        const x = -w / 2 + t + 0.01 + b.x;
        // Leaning books pivot on their bottom corner, so lift them by the lean.
        const lift = Math.sin(b.lean) * b.bw * 0.5;
        out.books.push({ size: [b.bw, b.bh, d * 0.72], position: [x + Math.sin(b.lean) * b.bh * 0.5, y + b.bh / 2 * Math.cos(b.lean) + lift, 0.01], rotation: [0, 0, -b.lean], colour: b.c });
        if (b.lean === 0) out.bands.push({ size: [b.bw * 0.8, 0.006, 0.001], position: [x, y + b.bh * 0.8, 0.01 + d * 0.36 + 0.0006] });
      }
    });
    return out;
  }, [books, shelves, w, h, d, t]);

  return (
    <group>
      {([-1, 1] as const).map((s) => (
        <Slab key={s} args={[t, h, d]} position={[s * (w / 2 - t / 2), h / 2, 0]} colour={body} radius={0.004} />
      ))}
      <Slab args={[w - t * 2, h - t, 0.008]} position={[0, h / 2, -d / 2 + 0.004]} colour={trim ?? body} radius={0.002} />

      {Array.from({ length: shelves + 1 }).map((_, i) => {
        const y = (i / shelves) * (h - t) + t / 2;
        return <Slab key={i} args={[w - t * 2, t, d - 0.01]} position={[0, y, 0.005]} colour={body} radius={0.003} />;
      })}
      {/* Kick plate */}
      <Slab args={[w - t * 2, 0.06, 0.016]} position={[0, 0.03, d / 2 - 0.012]} colour={body} radius={0.003} />

      {/* Every book on every shelf is one merged mesh, plus one for the gilt
          spine bands — a full bookcase would otherwise be ~100 draw calls. */}
      <MergedBoxes parts={bookParts.books}>
        <meshStandardMaterial vertexColors roughness={0.82} />
      </MergedBoxes>
      <MergedBoxes parts={bookParts.bands} castShadow={false}>
        <meshStandardMaterial color="#d9c27a" roughness={0.4} metalness={0.6} />
      </MergedBoxes>

      <TraceFace width={w} height={h} z={d / 2 + 0.004} texture={traceTexture} />
    </group>
  );
}

function Chair({ product }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, accent] = product.palette;
  const metal = accent ?? body;
  const seatT = 0.07;
  const gasH = h - seatT - 0.1;

  // An office chair: five-star base on castors, gas lift, cushioned seat and a
  // curved backrest — the chair that actually sits at a study desk.
  return (
    <group>
      {Array.from({ length: 5 }).map((_, i) => {
        const a = (i / 5) * Math.PI * 2;
        const r = Math.min(w, d) * 0.42;
        return (
          <group key={i} rotation={[0, a, 0]}>
            <Slab args={[0.03, 0.025, r]} position={[0, 0.06, r / 2]} colour={metal} finish="metal" radius={0.008} />
            <mesh position={[0, 0.025, r]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.025, 0.025, 0.022, 14]} />
              <meshStandardMaterial color="#1a1a1c" roughness={0.6} />
            </mesh>
          </group>
        );
      })}
      <Leg position={[0, 0.07 + gasH / 2, 0]} height={gasH} top={0.022} bottom={0.028} colour={metal} finish="metal" />

      {/* Seat */}
      <Slab args={[w * 0.92, seatT, d * 0.88]} position={[0, h - seatT / 2, 0.01]} colour={body} finish="fabric" radius={0.03} />

      {/* Backrest on a spine, slightly reclined and curved */}
      <Slab args={[0.05, h * 0.5, 0.025]} position={[0, h + h * 0.12, -d * 0.43]} rotation={[-0.08, 0, 0]} colour={metal} finish="metal" radius={0.01} />
      <group position={[0, h + h * 0.62, -d * 0.44]} rotation={[-0.1, 0, 0]}>
        {[-1, 0, 1].map((s) => (
          <Slab
            key={s}
            args={[w * 0.32, h * 0.95, 0.055]}
            position={[s * w * 0.28, 0, -Math.abs(s) * -0.03]}
            rotation={[0, -s * 0.28, 0]}
            colour={body}
            finish="fabric"
            radius={0.025}
          />
        ))}
      </group>

      {/* Armrests */}
      {([-1, 1] as const).map((s) => (
        <group key={`a${s}`} position={[s * (w * 0.46), h, -d * 0.05]}>
          <Slab args={[0.03, 0.2, 0.03]} position={[0, 0.1, 0]} colour={metal} finish="metal" radius={0.008} />
          <Slab args={[0.06, 0.025, d * 0.45]} position={[0, 0.21, 0]} colour="#1f1f22" finish="plastic" radius={0.01} />
        </group>
      ))}
    </group>
  );
}

/** Shared carcass for drawer furniture: top overhang, plinth or legs, drawers. */
function DrawerUnit({
  product,
  traceTexture,
  rows,
  columns = 1,
}: FurnitureProps & { rows: number; columns?: number }) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, trim] = product.palette;
  const front = trim ?? body;
  const topT = 0.022;
  const legH = 0.1;
  const caseH = h - topT - legH;
  const gap = 0.01;
  const fh = (caseH - 0.03 - gap * (rows - 1)) / rows;
  const fw = (w - 0.05 - gap * (columns - 1)) / columns;

  return (
    <group>
      {/* Splayed mid-century legs */}
      {([-1, 1] as const).map((sx) =>
        ([-1, 1] as const).map((sz) => (
          <Leg
            key={`${sx}${sz}`}
            position={[sx * (w / 2 - 0.05), legH / 2, sz * (d / 2 - 0.05)]}
            height={legH + 0.01}
            top={0.018}
            bottom={0.011}
            colour={body}
            tilt={[sz * 0.08, 0, -sx * 0.08]}
          />
        )),
      )}
      <Slab args={[w - 0.02, caseH, d - 0.02]} position={[0, legH + caseH / 2, -0.005]} colour={body} radius={0.006} />
      <Slab args={[w + 0.01, topT, d + 0.01]} position={[0, h - topT / 2, 0]} colour={body} radius={0.007} />

      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: columns }).map((__, c) => (
          <group key={`${r}${c}`} position={[-w / 2 + 0.025 + fw / 2 + c * (fw + gap), 0, 0]}>
            <DrawerFront
              width={fw}
              height={fh}
              y={legH + 0.015 + fh / 2 + r * (fh + gap)}
              z={(d - 0.02) / 2 - 0.005}
              colour={front}
            />
          </group>
        )),
      )}
      <TraceFace width={w} height={h} z={d / 2 + 0.04} texture={traceTexture} />
    </group>
  );
}

function Nightstand(props: FurnitureProps) {
  return <DrawerUnit {...props} rows={2} />;
}

function Dresser(props: FurnitureProps) {
  return <DrawerUnit {...props} rows={3} columns={props.product.dims.w > 90 ? 2 : 1} />;
}

function TvUnit({ product, traceTexture }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, trim] = product.palette;
  const accent = trim ?? body;
  const legH = h * 0.2;
  const caseH = h - legH;
  const t = 0.02;
  const openW = w * 0.34;

  return (
    <group>
      {([-1, 1] as const).map((sx) =>
        ([-1, 1] as const).map((sz) => (
          <Leg
            key={`${sx}${sz}`}
            position={[sx * (w / 2 - 0.06), legH / 2, sz * (d / 2 - 0.06)]}
            height={legH}
            top={0.016}
            bottom={0.012}
            colour={accent}
          />
        )),
      )}
      {/* Carcass */}
      <Slab args={[w, t, d]} position={[0, h - t / 2, 0]} colour={body} radius={0.006} />
      <Slab args={[w, t, d]} position={[0, legH + t / 2, 0]} colour={body} radius={0.006} />
      {([-1, 1] as const).map((s) => (
        <Slab key={s} args={[t, caseH, d]} position={[s * (w / 2 - t / 2), legH + caseH / 2, 0]} colour={body} radius={0.004} />
      ))}
      <Slab args={[w - t * 2, caseH - t * 2, 0.008]} position={[0, legH + caseH / 2, -d / 2 + 0.004]} colour={body} radius={0.002} />

      {/* Open centre bay with a divider shelf, slatted doors either side */}
      {([-1, 1] as const).map((s) => (
        <Slab key={`p${s}`} args={[t, caseH - t * 2, d - 0.02]} position={[s * openW / 2, legH + caseH / 2, 0]} colour={body} radius={0.003} />
      ))}
      <Slab args={[openW - t, t, d - 0.03]} position={[0, legH + caseH / 2, 0]} colour={body} radius={0.003} />
      {([-1, 1] as const).map((s) => {
        const doorW = (w - openW) / 2 - t * 1.5;
        const cx = s * (openW / 2 + doorW / 2 + t * 0.5);
        const slats = Math.max(6, Math.round(doorW / 0.025));
        const slatParts: BoxPart[] = Array.from({ length: slats }).map((_, i) => ({
          size: [doorW / slats - 0.004, caseH - t * 3, 0.008],
          position: [-doorW / 2 + (i + 0.5) * (doorW / slats), 0, 0.01],
        }));
        return (
          <group key={`d${s}`} position={[cx, legH + caseH / 2, d / 2 - 0.01]}>
            <Slab args={[doorW, caseH - t * 2.4, 0.014]} colour={accent} radius={0.003} />
            <MergedBoxes parts={slatParts}>
              <FinishMaterial colour={accent} />
            </MergedBoxes>
          </group>
        );
      })}
      <TraceFace width={w} height={h} z={d / 2 + 0.03} texture={traceTexture} />
    </group>
  );
}

function Sofa({ product, traceTexture }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, trim] = product.palette;
  const legH = 0.08;
  const baseH = h * 0.5;
  const armW = Math.min(0.18, w * 0.12);
  const seats = w > 1.7 ? 3 : 2;
  const seatW = (w - armW * 2) / seats;
  const backD = d * 0.24;

  return (
    <group>
      {([-1, 1] as const).map((sx) =>
        ([-1, 1] as const).map((sz) => (
          <Leg
            key={`${sx}${sz}`}
            position={[sx * (w / 2 - 0.08), legH / 2, sz * (d / 2 - 0.08)]}
            height={legH}
            top={0.018}
            bottom={0.012}
            colour={trim ?? "#3a2a1c"}
            finish="wood"
          />
        )),
      )}
      {/* Base frame */}
      <Slab args={[w, baseH - legH, d]} position={[0, legH + (baseH - legH) / 2, 0]} colour={trim ?? body} finish="fabric" radius={0.03} />

      {/* Seat cushions, top face at the product height */}
      {Array.from({ length: seats }).map((_, i) => (
        <Slab
          key={i}
          args={[seatW - 0.01, h - baseH + 0.02, d - backD - 0.02]}
          position={[-w / 2 + armW + seatW * (i + 0.5), baseH + (h - baseH) / 2 - 0.01, backD / 2]}
          colour={body}
          finish="fabric"
          radius={0.045}
        />
      ))}

      {/* Back cushions, leaning back slightly */}
      {Array.from({ length: seats }).map((_, i) => (
        <Slab
          key={`b${i}`}
          args={[seatW - 0.01, h * 1.05, backD]}
          position={[-w / 2 + armW + seatW * (i + 0.5), h + h * 0.4, -d / 2 + backD / 2 + 0.01]}
          rotation={[-0.12, 0, 0]}
          colour={body}
          finish="fabric"
          radius={0.05}
        />
      ))}

      {/* Rolled arms */}
      {([-1, 1] as const).map((s) => (
        <Slab
          key={`a${s}`}
          args={[armW, h * 0.9, d]}
          position={[s * (w / 2 - armW / 2), legH + h * 0.45, 0]}
          colour={body}
          finish="fabric"
          radius={0.06}
        />
      ))}

      <TraceFace width={w} height={h} z={d / 2 + 0.02} texture={traceTexture} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Openings — wall-mounted, local +Z points out of the wall            */
/* ------------------------------------------------------------------ */

function Doorway({ product, traceTexture }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [door, frame] = product.palette;
  const jamb = 0.06;

  return (
    <group>
      {/* Wall items are centred on their mount point, so the opening spans ±h/2 */}
      <mesh position={[0, 0, d / 2]} receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#0d0d0f" roughness={1} />
      </mesh>

      <Panel args={[w * 0.94, h * 0.96, d * 0.7]} position={[0, -h * 0.02, d * 0.4]} colour={door} />

      {/* Architrave */}
      <Panel args={[w + jamb, jamb, d * 1.2]} position={[0, h / 2 + jamb / 2, d * 0.6]} colour={frame ?? door} />
      {([-1, 1] as const).map((s) => (
        <Panel
          key={s}
          args={[jamb, h + jamb, d * 1.2]}
          position={[s * (w / 2 + jamb / 2), 0, d * 0.6]}
          colour={frame ?? door}
        />
      ))}

      <mesh position={[w * 0.36, -h * 0.03, d * 0.78]} castShadow>
        <sphereGeometry args={[0.022, 12, 10]} />
        <meshStandardMaterial color="#b9bcc2" roughness={0.25} metalness={0.9} />
      </mesh>

      <TraceFace width={w} height={h} z={d * 0.9} texture={traceTexture} />
    </group>
  );
}

function WindowFrame({ product, traceTexture, light }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [glass, frame] = product.palette;
  const bar = 0.045;

  return (
    <group>
      {/* Daylight panel. A window really is a light source, and treating it as
          one is what stops a room with a window reading as a sealed box. */}
      <mesh position={[0, 0, d * 0.35]}>
        <planeGeometry args={[w - bar, h - bar]} />
        <meshStandardMaterial
          color={glass}
          emissive={glass}
          emissiveIntensity={1.5}
          roughness={0.1}
          toneMapped={false}
          side={DoubleSide}
        />
      </mesh>

      <Panel args={[w + bar, bar, d]} position={[0, h / 2, d / 2]} colour={frame ?? "#8a8a92"} />
      <Panel args={[w + bar, bar, d]} position={[0, -h / 2, d / 2]} colour={frame ?? "#8a8a92"} />
      {([-1, 1] as const).map((s) => (
        <Panel
          key={s}
          args={[bar, h, d]}
          position={[s * (w / 2), 0, d / 2]}
          colour={frame ?? "#8a8a92"}
        />
      ))}
      <Panel args={[bar * 0.6, h, d * 0.8]} position={[0, 0, d * 0.5]} colour={frame ?? "#8a8a92"} />
      <Panel args={[w, bar * 0.6, d * 0.8]} position={[0, 0, d * 0.5]} colour={frame ?? "#8a8a92"} />

      {/* Sill */}
      <Panel args={[w + bar * 2, bar * 0.8, d * 2.4]} position={[0, -h / 2 - bar * 0.6, d * 1.1]} colour={frame ?? "#8a8a92"} />

      {light && (
        <pointLight
          position={[0, 0, 0.6]}
          color={glass}
          intensity={3.2}
          distance={6}
          decay={2}
        />
      )}

      <TraceFace width={w} height={h} z={d * 0.9} texture={traceTexture} />
    </group>
  );
}

/* ------------------------------------------------------------------ */

export const FURNITURE_MODELS: Record<
  string,
  React.ComponentType<FurnitureProps>
> = {
  bed: Bed,
  desk: Desk,
  wardrobe: Wardrobe,
  bookshelfTall: BookshelfTall,
  chair: Chair,
  nightstand: Nightstand,
  dresser: Dresser,
  tvUnit: TvUnit,
  sofa: Sofa,
  doorway: Doorway,
  windowFrame: WindowFrame,
};
