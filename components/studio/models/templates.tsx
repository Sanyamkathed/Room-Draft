"use client";

import * as React from "react";
import { ExtrudeGeometry, Path, Shape } from "three";
import type { CustomTemplate, Product } from "@/lib/catalog/types";
import { FinishMaterial, Leg, Slab } from "./finish";
import { MirrorGlass } from "./mirror";
import { M } from "./shapes";
import { sofaGeometry } from "@/lib/catalog/templateGeometry";

/**
 * Matched models for items imported from a photo.
 *
 * A single photo shows one side of a sofa; anything built from its outline
 * looks right from the front and wrong from everywhere else. These are real
 * 3D models of the item's TYPE, at the user's measurements and in the photo's
 * colours, so they hold up from any angle and stand still while you walk
 * round them. All models share the floor/tabletop frame (base at y=0,
 * centred in x/z) — or the wall frame for a wall mirror (contact at z=0).
 */
export function TemplateModel({ product, template }: { product: Product; template: CustomTemplate }) {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const d = M(product.dims.d);
  switch (template.kind) {
    case "sofa":
    case "armchair":
      return <SofaModel w={w} h={h} d={d} t={template} />;
    case "table":
      return <TableModel w={w} h={h} d={d} t={template} />;
    case "mirror":
      return <MirrorModel w={w} h={h} d={d} t={template} wall={product.mount === "wall"} />;
    default:
      return null;
  }
}

function SofaModel({ w, h, d, t }: { w: number; h: number; d: number; t: CustomTemplate }) {
  const [body, accent, light] = t.colours;
  const { seats, legH, seatTop, cushionT, armW, armH, backD } = sofaGeometry(w, h, d, t);
  const round = t.arms === "round";
  const innerW = w - armW * 2;
  const seatW = innerW / seats;
  const plinthTop = seatTop - cushionT;
  const backH = h - plinthTop;

  return (
    <group>
      {/* Short tapered legs, set in from the corners */}
      {([-1, 1] as const).map((sx) =>
        ([-1, 1] as const).map((sz) => (
          <Leg
            key={`${sx}${sz}`}
            position={[sx * (w / 2 - 0.07), legH / 2, sz * (d / 2 - 0.07)]}
            height={legH}
            top={0.018}
            bottom={0.012}
            colour={accent}
            finish={looksDark(accent) ? "paint" : "wood"}
          />
        )),
      )}

      {/* Frame: the upholstered box everything sits on */}
      <Slab args={[w, plinthTop - legH, d]} position={[0, legH + (plinthTop - legH) / 2, 0]} colour={body} finish="fabric" radius={0.035} />

      {/* Back frame behind the cushions */}
      <Slab
        args={[innerW + 0.02, backH * 0.92, backD * 0.55]}
        position={[0, plinthTop + backH * 0.46, -d / 2 + backD * 0.275]}
        colour={body}
        finish="fabric"
        radius={0.04}
      />

      {/* Seat cushions, each its own soft box with a seam between */}
      {Array.from({ length: seats }).map((_, i) => (
        <Slab
          key={`s${i}`}
          args={[seatW - 0.012, cushionT + 0.01, d - backD - 0.015]}
          position={[-innerW / 2 + seatW * (i + 0.5), plinthTop + cushionT / 2, backD / 2]}
          colour={body}
          finish="fabric"
          radius={0.05}
        />
      ))}

      {/* Back cushions, leaning back a little */}
      {Array.from({ length: seats }).map((_, i) => (
        <Slab
          key={`b${i}`}
          args={[seatW - 0.014, backH * 0.74, backD * 0.62]}
          position={[-innerW / 2 + seatW * (i + 0.5), seatTop + backH * 0.3, -d / 2 + backD * 0.55 + 0.04]}
          rotation={[-0.13, 0, 0]}
          colour={body}
          finish="fabric"
          radius={0.06}
        />
      ))}

      {/* Arms: crisp track arms, or rolled */}
      {([-1, 1] as const).map((s) =>
        round ? (
          <group key={`a${s}`}>
            <Slab args={[armW, armH - legH - armW * 0.5, d]} position={[s * (w / 2 - armW / 2), legH + (armH - legH - armW * 0.5) / 2, 0]} colour={body} finish="fabric" radius={0.03} />
            <mesh position={[s * (w / 2 - armW / 2), armH - armW * 0.5, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[armW * 0.55, armW * 0.55, d, 24]} />
              <FinishMaterial colour={body} finish="fabric" />
            </mesh>
          </group>
        ) : (
          <Slab key={`a${s}`} args={[armW, armH - legH, d]} position={[s * (w / 2 - armW / 2), legH + (armH - legH) / 2, 0]} colour={body} finish="fabric" radius={0.04} />
        ),
      )}

      {/* Two throw pillows, angled against the arms */}
      {seats > 1 &&
        ([-1, 1] as const).map((s) => (
          <Slab
            key={`p${s}`}
            args={[Math.min(0.44, seatW * 0.55), Math.min(0.42, backH * 0.6), 0.13]}
            position={[s * (innerW / 2 - Math.min(0.24, seatW * 0.3)), seatTop + Math.min(0.2, backH * 0.3), -d / 2 + backD + 0.1]}
            rotation={[-0.25, s * -0.35, s * 0.12]}
            colour={light}
            finish="fabric"
            radius={0.06}
          />
        ))}
    </group>
  );
}

function TableModel({ w, h, d, t }: { w: number; h: number; d: number; t: CustomTemplate }) {
  const [top, legs] = t.colours;
  const thick = Math.min(0.04, Math.max(0.018, h * 0.05));
  const round = t.shape === "round";
  const legH = h - thick;
  const topFinish = looksDark(top) ? "paint" : "auto";

  return (
    <group>
      {round ? (
        <mesh position={[0, h - thick / 2, 0]} scale={[w / 2, 1, d / 2]} castShadow receiveShadow>
          <cylinderGeometry args={[1, 1, thick, 48]} />
          <FinishMaterial colour={top} finish={topFinish} />
        </mesh>
      ) : (
        <Slab args={[w, thick, d]} position={[0, h - thick / 2, 0]} colour={top} finish={topFinish} radius={0.006} />
      )}
      {t.base === "pedestal" ? (
        <>
          <Leg position={[0, legH / 2, 0]} height={legH} top={Math.min(0.05, w * 0.06)} bottom={Math.min(0.04, w * 0.05)} colour={legs} />
          <mesh position={[0, 0.012, 0]} scale={[Math.min(w, d) * 0.32, 1, Math.min(w, d) * 0.32]} castShadow receiveShadow>
            <cylinderGeometry args={[1, 1, 0.024, 40]} />
            <FinishMaterial colour={legs} />
          </mesh>
        </>
      ) : (
        ([-1, 1] as const).map((sx) =>
          ([-1, 1] as const).map((sz) => {
            const inset = round ? 0.3 : 0.06;
            const x = round ? sx * (w / 2) * inset * 2.2 : sx * (w / 2 - inset);
            const z = round ? sz * (d / 2) * inset * 2.2 : sz * (d / 2 - inset);
            return <Leg key={`${sx}${sz}`} position={[x, legH / 2, z]} height={legH} top={0.02} bottom={0.014} colour={legs} />;
          }),
        )
      )}
    </group>
  );
}

/** The outline of a mirror (or its glass), centred on the origin. */
function outline(shape: CustomTemplate["shape"], w: number, h: number): Shape {
  const s = new Shape();
  const x0 = -w / 2;
  const y0 = -h / 2;
  if (shape === "round") {
    s.absellipse(0, 0, w / 2, h / 2, 0, Math.PI * 2, false, 0);
    return s;
  }
  if (shape === "arch") {
    const r = w / 2;
    s.moveTo(x0, y0);
    s.lineTo(x0 + w, y0);
    s.lineTo(x0 + w, y0 + h - r);
    s.absarc(0, y0 + h - r, r, 0, Math.PI, false);
    s.lineTo(x0, y0);
    return s;
  }
  const r = shape === "rounded" ? Math.min(w, h) * 0.16 : Math.min(w, h) * 0.01;
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0);
  s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + h - r);
  s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  s.lineTo(x0 + r, y0 + h);
  s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

/**
 * A mirror: thin frame, real reflective glass. On a wall it hangs flat; on
 * the floor it is a full-length mirror leaning back against the wall behind
 * it, the way they are actually used.
 */
function MirrorModel({ w, h, d, t, wall }: { w: number; h: number; d: number; t: CustomTemplate; wall: boolean }) {
  const [frame] = t.colours;
  const shape = t.shape ?? "rounded";
  const lean = wall ? 0 : 0.11;
  // Height along the leaning panel, so the top still reaches h.
  const ph = wall ? h : h / Math.cos(lean);
  const pw = w;
  const fw = Math.max(0.012, Math.min(0.035, Math.min(pw, ph) * 0.035));
  const thick = wall ? Math.max(0.015, Math.min(d, 0.04)) : 0.028;

  const { frameGeo, glass } = React.useMemo(() => {
    const outer = outline(shape, pw, ph);
    const inner = outline(shape, pw - fw * 2, ph - fw * 2);
    const ring = outline(shape, pw, ph);
    ring.holes.push(new Path(inner.getPoints(64)));
    const geo = new ExtrudeGeometry(ring, {
      depth: thick,
      bevelEnabled: true,
      bevelThickness: Math.min(0.004, thick * 0.2),
      bevelSize: Math.min(0.003, fw * 0.25),
      bevelSegments: 2,
      curveSegments: 32,
    });
    void outer;
    return { frameGeo: geo, glass: inner };
  }, [shape, pw, ph, fw, thick]);
  React.useEffect(() => () => frameGeo.dispose(), [frameGeo]);

  const finish = looksDark(frame) ? "plastic" : /^#(c9|b8)/i.test(frame) ? "metal" : "auto";
  const panel = (
    <group>
      <mesh geometry={frameGeo} castShadow receiveShadow>
        <FinishMaterial colour={frame} finish={finish} />
      </mesh>
      {/* Backing board */}
      <mesh position={[0, 0, 0.002]}>
        <shapeGeometry args={[glass, 32]} />
        <meshStandardMaterial color="#2c2b29" roughness={0.9} />
      </mesh>
      <MirrorGlass shape={<shapeGeometry args={[glass, 32]} />} position={[0, 0, thick * 0.55]} />
    </group>
  );

  if (wall) return <group>{panel}</group>;
  // Standing: the bottom edge rests at the front of its footprint, the top
  // leans back toward the wall behind it.
  return (
    <group position={[0, 0, d / 2 - thick - 0.01]} rotation={[-lean, 0, 0]}>
      <group position={[0, ph / 2, 0]}>{panel}</group>
    </group>
  );
}

function looksDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const l = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return l < 70;
}
