"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ACESFilmicToneMapping, PMREMGenerator, type Group } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { formatDims, formatINR } from "@/lib/catalog/source";
import type { Product } from "@/lib/catalog/types";
import type { Vec3 } from "@/lib/room/types";
import { ProductModel } from "./models/ProductModel";

/**
 * A turntable preview of a library item, shown beside the library on hover.
 *
 * One small canvas serves every card: it is created on the first hover and
 * then only swaps what it shows, and it stops rendering entirely while nothing
 * is hovered. A canvas per card — or one created per hover — would mean
 * dozens of WebGL contexts beside the studio's own, which is exactly how a
 * modest GPU ends up dropping the main view.
 *
 * Mouse only: a touch screen has no hover, and a press there already means
 * "pick this up".
 */
export function HoverPreview({
  product,
  anchor,
}: {
  product: Product | null;
  /** Vertical centre of the hovered card, and the panel's right edge. */
  anchor: { y: number; x: number } | null;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    if (product) setMounted(true);
  }, [product]);

  if (!mounted || typeof document === "undefined") return null;

  const H = 300;
  const visible = Boolean(product && anchor);
  const top = anchor ? Math.max(68, Math.min(window.innerHeight - H - 16, anchor.y - H / 2)) : 0;

  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed z-50 w-[260px] overflow-hidden rounded-[18px] border border-white/12 bg-ink-1/95 shadow-2xl backdrop-blur-xl transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{
        left: (anchor?.x ?? 0) + 12,
        top,
        height: H,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0) scale(1)" : "translateX(-6px) scale(0.97)",
      }}
    >
      <div className="h-[226px] w-full bg-[radial-gradient(ellipse_at_50%_40%,#2a2a30_0%,#141417_70%)]">
        <PreviewStage product={product} active={visible} />
      </div>
      {product ? (
        <div className="px-3.5 py-2.5">
          <p className="truncate text-[13px] font-semibold tracking-[-0.015em] text-chalk">{product.name}</p>
          <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-chalk-4">
            {!product.isFurniture && product.price > 0 && <span className="font-semibold text-chalk-2">{formatINR(product.price)}</span>}
            <span className="tabular-nums">{formatDims(product)}</span>
          </p>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

/**
 * The turntable canvas on its own, for anywhere that needs to show one item
 * in 3D (the hover card, the item builder). `active` pauses rendering.
 */
export function PreviewStage({ product, active = true }: { product: Product | null; active?: boolean }) {
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={[1, 1.5]}
      camera={{ fov: 32, near: 0.01, far: 50, position: [0, 0, 2] }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power", preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.1;
      }}
    >
      <Studio />
      {product ? <Turntable key={`${product.id}:${product.custom?.updatedAt ?? 0}`} product={product} /> : null}
    </Canvas>
  );
}

/** Soft studio lighting plus a built-in reflection map, so metal reads as metal. */
export function Studio() {
  const { gl, scene } = useThree();
  React.useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  return (
    <>
      <hemisphereLight args={["#fff6ea", "#3a3530", 0.7]} />
      <directionalLight position={[2, 3, 2.5]} intensity={1.6} />
      <directionalLight position={[-2.5, 1, -1]} intensity={0.5} color="#bcd0ff" />
    </>
  );
}

/** The product, centred and framed by its real size, turning slowly. */
function Turntable({ product }: { product: Product }) {
  const spin = React.useRef<Group>(null);
  const { camera } = useThree();
  const wall = product.mount === "wall";
  const edge = product.mount === "edge";

  const w = product.dims.w / 100;
  const h = product.dims.h / 100;
  const d = product.dims.d / 100;
  const runLength = Math.min(w, 0.6);
  const path: [Vec3, Vec3] | undefined = edge ? [[-runLength / 2, 0, 0], [runLength / 2, 0, 0]] : undefined;

  // Models are authored from the face that touches the world; shift each so
  // its middle sits on the turntable's axis.
  const offset: Vec3 = wall
    ? [0, 0, -d / 2]
    : product.mount === "ceiling"
      ? [0, h / 2, 0]
      : edge
        ? [0, 0, 0]
        : [0, -h / 2, 0];

  const size = edge ? runLength : Math.max(w, h, d);

  React.useLayoutEffect(() => {
    const dist = (size / 2 / Math.tan(((32 / 2) * Math.PI) / 180)) * 1.35;
    camera.position.set(0, size * 0.18, Math.max(0.12, dist));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, size]);

  useFrame(({ clock }) => {
    const g = spin.current;
    if (!g) return;
    const t = clock.elapsedTime;
    // Flat wall pieces swing to show their depth; everything else turns.
    g.rotation.y = wall || edge ? Math.sin(t * 0.8) * 0.55 : t * 0.6;
  });

  return (
    <group ref={spin}>
      <group position={offset}>
        <ProductModel product={product} path={path} light={false} />
      </group>
    </group>
  );
}
