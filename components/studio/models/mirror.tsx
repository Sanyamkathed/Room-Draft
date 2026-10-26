"use client";

import * as React from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BackSide,
  CubeCamera,
  HalfFloatType,
  Vector3,
  WebGLCubeRenderTarget,
  type Mesh,
  type Object3D,
  type Texture,
} from "three";
import type { Vec3 } from "@/lib/room/types";

const _mirrorPos = new Vector3();

/**
 * Mirror glass that reflects the actual room.
 *
 * A cube camera captures the scene from where the mirror stands, with the
 * glass hidden, and the glass shows that capture. It re-captures only once
 * the mirror has stayed put for a few frames — six small renders after a
 * move, not a second scene render every frame, which a phone can't afford.
 */
export function MirrorGlass({
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

