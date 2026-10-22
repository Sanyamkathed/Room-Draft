"use client";

import * as React from "react";
import { DoubleSide, type Texture } from "three";
import type { Product } from "@/lib/catalog/types";
import { M, seededRandom } from "./shapes";

/**
 * The furniture already in the room.
 *
 * Low-poly on purpose. These are stand-ins for objects the user can see in
 * their own photo — their job is to occupy the right VOLUME so decor collides
 * with them and rests on them, not to be admired. Detail goes into the decor
 * the user is actually shopping for.
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
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={colour} roughness={rough} metalness={0.04} />
    </mesh>
  );
}

function Handle({ position, length }: { position: [number, number, number]; length: number }) {
  return (
    <mesh position={position} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[0.008, 0.008, length, 8]} />
      <meshStandardMaterial color="#9aa0a6" roughness={0.3} metalness={0.85} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */

function Bed({ product, traceTexture }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [linen, frame] = product.palette;

  const frameH = h * 0.5;
  const mattressH = h - frameH;

  return (
    <group>
      <Panel args={[w, frameH, d]} position={[0, frameH / 2, 0]} colour={frame} />
      <Panel
        args={[w * 0.98, mattressH, d * 0.98]}
        position={[0, frameH + mattressH / 2, 0]}
        colour={linen}
        rough={0.94}
      />

      {/* Duvet over the lower two-thirds, slightly proud of the mattress */}
      <mesh position={[0, h + 0.012, d * 0.16]} castShadow receiveShadow>
        <boxGeometry args={[w * 0.99, 0.05, d * 0.66]} />
        <meshStandardMaterial color={linen} roughness={0.98} />
      </mesh>

      {/* Pillows at the head end */}
      {w > M(110) ? (
        [-1, 1].map((s) => (
          <mesh
            key={s}
            position={[s * w * 0.24, h + 0.045, -d * 0.38]}
            castShadow
          >
            <boxGeometry args={[w * 0.4, 0.09, d * 0.14]} />
            <meshStandardMaterial color="#f2efe8" roughness={0.96} />
          </mesh>
        ))
      ) : (
        <mesh position={[0, h + 0.045, -d * 0.38]} castShadow>
          <boxGeometry args={[w * 0.72, 0.09, d * 0.14]} />
          <meshStandardMaterial color="#f2efe8" roughness={0.96} />
        </mesh>
      )}

      {/* Headboard rises past the box on purpose — see the module note */}
      <Panel
        args={[w, h * 1.5, 0.05]}
        position={[0, h * 0.75, -d / 2 - 0.02]}
        colour={frame}
      />

      <TraceFace width={w} height={h} z={d / 2 + 0.004} texture={traceTexture} />
    </group>
  );
}

function Desk({ product, traceTexture }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [top, leg] = product.palette;
  const slab = 0.035;

  return (
    <group>
      <Panel args={[w, slab, d]} position={[0, h - slab / 2, 0]} colour={top} rough={0.55} />

      {([-1, 1] as const).map((sx) =>
        ([-1, 1] as const).map((sz) => (
          <Panel
            key={`${sx}${sz}`}
            args={[0.05, h - slab, 0.05]}
            position={[sx * (w / 2 - 0.05), (h - slab) / 2, sz * (d / 2 - 0.05)]}
            colour={leg ?? top}
            rough={0.45}
          />
        )),
      )}

      {/* Modesty panel — also stops you seeing straight through the desk */}
      <Panel
        args={[w * 0.9, h * 0.32, 0.02]}
        position={[0, h * 0.52, -d / 2 + 0.06]}
        colour={leg ?? top}
      />

      <TraceFace width={w} height={h} z={d / 2 + 0.004} texture={traceTexture} />
    </group>
  );
}

function Wardrobe({ product, traceTexture }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, trim] = product.palette;

  return (
    <group>
      <Panel args={[w, h, d]} position={[0, h / 2, 0]} colour={body} />

      {/* Two doors with a centre reveal */}
      {([-1, 1] as const).map((s) => (
        <Panel
          key={s}
          args={[w / 2 - 0.012, h - 0.04, 0.018]}
          position={[s * (w / 4), h / 2, d / 2 + 0.009]}
          colour={trim ?? body}
          rough={0.5}
        />
      ))}
      {([-1, 1] as const).map((s) => (
        <mesh key={`h${s}`} position={[s * 0.03, h * 0.5, d / 2 + 0.03]} castShadow>
          <cylinderGeometry args={[0.008, 0.008, h * 0.22, 8]} />
          <meshStandardMaterial color="#9aa0a6" roughness={0.3} metalness={0.85} />
        </mesh>
      ))}

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
  const rnd = React.useMemo(() => seededRandom(product.id), [product.id]);

  return (
    <group>
      {([-1, 1] as const).map((s) => (
        <Panel
          key={s}
          args={[t, h, d]}
          position={[s * (w / 2 - t / 2), h / 2, 0]}
          colour={body}
        />
      ))}
      <Panel args={[w, h, t]} position={[0, h / 2, -d / 2 + t / 2]} colour={trim ?? body} />

      {Array.from({ length: shelves + 1 }).map((_, i) => {
        const y = (i / shelves) * (h - t) + t / 2;
        return (
          <Panel
            key={i}
            args={[w - t * 2, t, d - t]}
            position={[0, y, t / 2]}
            colour={body}
          />
        );
      })}

      {/* A few books, so an empty shelf doesn't read as a broken model */}
      {Array.from({ length: shelves }).map((_, i) => {
        const y = (i / shelves) * (h - t) + t / 2;
        const count = 3 + Math.floor(rnd() * 5);
        return (
          <group key={`b${i}`} position={[-w / 2 + t + 0.03, y + t / 2, 0]}>
            {Array.from({ length: count }).map((__, j) => {
              const bw = 0.022 + rnd() * 0.016;
              const bh = 0.17 + rnd() * 0.07;
              return (
                <mesh
                  key={j}
                  position={[j * 0.042, bh / 2, 0]}
                  rotation={[0, 0, rnd() < 0.15 ? 0.16 : 0]}
                  castShadow
                >
                  <boxGeometry args={[bw, bh, d * 0.7]} />
                  <meshStandardMaterial
                    color={["#6b2b2b", "#2a3a5a", "#c9a227", "#3f6b46", "#e8e2d4"][j % 5]}
                    roughness={0.85}
                  />
                </mesh>
              );
            })}
          </group>
        );
      })}

      <TraceFace width={w} height={h} z={d / 2 + 0.004} texture={traceTexture} />
    </group>
  );
}

function Chair({ product }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, accent] = product.palette;

  return (
    <group>
      <Panel args={[w * 0.9, 0.06, d * 0.9]} position={[0, h - 0.03, 0]} colour={body} rough={0.85} />

      {([-1, 1] as const).map((sx) =>
        ([-1, 1] as const).map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            position={[sx * (w * 0.36), (h - 0.06) / 2, sz * (d * 0.36)]}
            castShadow
          >
            <cylinderGeometry args={[0.016, 0.014, h - 0.06, 8]} />
            <meshStandardMaterial color={accent ?? body} roughness={0.4} metalness={0.5} />
          </mesh>
        )),
      )}

      {/* Backrest — above the seat box, which is where things actually rest */}
      <Panel
        args={[w * 0.86, h * 0.85, 0.05]}
        position={[0, h + h * 0.42, -d * 0.4]}
        colour={body}
        rough={0.85}
      />
    </group>
  );
}

function Nightstand({ product, traceTexture }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, trim] = product.palette;

  return (
    <group>
      <Panel args={[w, h, d]} position={[0, h / 2, 0]} colour={body} />
      {[0, 1].map((i) => {
        const y = h * (0.3 + i * 0.38);
        return (
          <group key={i}>
            <Panel
              args={[w - 0.04, h * 0.3, 0.016]}
              position={[0, y, d / 2 + 0.008]}
              colour={trim ?? body}
              rough={0.5}
            />
            <Handle position={[0, y, d / 2 + 0.026]} length={w * 0.4} />
          </group>
        );
      })}
      <TraceFace width={w} height={h} z={d / 2 + 0.04} texture={traceTexture} />
    </group>
  );
}

function Dresser({ product, traceTexture }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, trim] = product.palette;

  return (
    <group>
      <Panel args={[w, h, d]} position={[0, h / 2, 0]} colour={body} />
      {[0, 1, 2].map((i) => {
        const y = h * (0.19 + i * 0.3);
        return (
          <group key={i}>
            <Panel
              args={[w - 0.05, h * 0.26, 0.016]}
              position={[0, y, d / 2 + 0.008]}
              colour={trim ?? body}
              rough={0.5}
            />
            <Handle position={[0, y, d / 2 + 0.026]} length={w * 0.34} />
          </group>
        );
      })}
      <TraceFace width={w} height={h} z={d / 2 + 0.04} texture={traceTexture} />
    </group>
  );
}

function TvUnit({ product, traceTexture }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, trim] = product.palette;

  return (
    <group>
      <Panel args={[w, h * 0.82, d]} position={[0, h * 0.59, 0]} colour={body} />
      {([-1, 1] as const).map((s) => (
        <Panel
          key={s}
          args={[0.04, h * 0.18, 0.04]}
          position={[s * (w / 2 - 0.06), h * 0.09, 0]}
          colour={trim ?? body}
          rough={0.4}
        />
      ))}
      {([-1, 1] as const).map((s) => (
        <Panel
          key={`d${s}`}
          args={[w / 2 - 0.03, h * 0.5, 0.014]}
          position={[s * (w / 4), h * 0.55, d / 2 + 0.007]}
          colour={trim ?? body}
          rough={0.45}
        />
      ))}
      <TraceFace width={w} height={h} z={d / 2 + 0.03} texture={traceTexture} />
    </group>
  );
}

function Sofa({ product, traceTexture }: FurnitureProps) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  const [body, trim] = product.palette;

  return (
    <group>
      <Panel args={[w, h * 0.62, d]} position={[0, h * 0.31, 0]} colour={trim ?? body} rough={0.95} />

      {/* Seat cushions */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * w * 0.24, h * 0.78, d * 0.06]} castShadow receiveShadow>
          <boxGeometry args={[w * 0.46, h * 0.34, d * 0.8]} />
          <meshStandardMaterial color={body} roughness={0.96} />
        </mesh>
      ))}

      {/* Back and arms rise above the seat box */}
      <Panel
        args={[w, h * 1.5, d * 0.22]}
        position={[0, h * 0.9, -d * 0.39]}
        colour={body}
        rough={0.96}
      />
      {([-1, 1] as const).map((s) => (
        <Panel
          key={`a${s}`}
          args={[d * 0.16, h * 0.95, d]}
          position={[s * (w / 2 - d * 0.08), h * 0.62, 0]}
          colour={body}
          rough={0.96}
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
