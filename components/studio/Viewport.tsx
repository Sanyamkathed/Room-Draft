"use client";

import * as React from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { AdaptiveDpr, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, SMAA, Vignette } from "@react-three/postprocessing";
import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  Vector3,
  type PerspectiveCamera as ThreePerspectiveCamera,
} from "three";
import { productById } from "@/lib/catalog/source";
import { carryDependents } from "@/lib/placement/carry";
import type { PlacedItem } from "@/lib/placement/types";
import { createEnvironmentTexture } from "@/lib/three/env";
import { applyPhotoCamera, clearPhotoCamera } from "@/lib/three/photoCamera";
import type { RoomGeometry, Vec3 } from "@/lib/room/types";
import { useStudio, type CameraMode } from "@/lib/store/studio";
import { DragController } from "./DragController";
import { TwistController } from "./TwistController";
import { PlacedObject } from "./PlacedObject";
import { ProjectionPools } from "./ProjectionPool";
import { RoomShell } from "./RoomShell";

/** A phone or tablet: a touch-first device with a small, dense screen. */
const IS_TOUCH =
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/** Ceiling on simultaneous real lights — beyond this the cost is not worth it. */
const MAX_DYNAMIC_LIGHTS = 8;

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

export function ProceduralEnvironment({
  room,
  dim = false,
}: {
  room: RoomGeometry;
  dim?: boolean;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  React.useEffect(() => {
    const texture = createEnvironmentTexture(gl, {
      // Tinting the environment with the room's own palette makes reflections
      // agree with the photo rather than importing a foreign studio look —
      // but over a photo-textured room that same tint would be applied a
      // second time to pixels that already contain it, so it goes neutral and
      // dim there and only colours the clean-material view.
      sky: dim ? "#b8bcc2" : room.palette.ceiling,
      ground: dim ? "#6e6a64" : room.palette.floor,
      intensity: dim ? 0.26 : 0.7,
    });
    scene.environment = texture;
    return () => {
      scene.environment = null;
      texture.dispose();
    };
  }, [gl, scene, room.palette.ceiling, room.palette.floor, dim]);

  return null;
}

/* ------------------------------------------------------------------ */
/* Lighting                                                            */
/* ------------------------------------------------------------------ */

export function Lighting({
  room,
  photoTexture = true,
}: {
  room: RoomGeometry;
  photoTexture?: boolean;
}) {
  const { width, height, depth } = room.dimensions;
  const span = Math.max(width, depth);

  // A photo already has its lighting baked into the pixels. Lighting those
  // pixels again blows the walls out to white and erases the room the user
  // actually photographed — so in photo mode the rig drops to roughly a third
  // and exists mainly to give placed objects somewhere to cast shadows. Clean
  // material mode has no baked light, so it gets the full rig.
  const k = photoTexture ? 0.28 : 1;

  return (
    <>
      {/* Over a photo the hemisphere must stay NEUTRAL. Tinting it with the
          room's own ceiling and floor colours double-applies that colour to
          pixels that already contain it, and the reconstructed half of a
          before/after visibly drifts green or brown away from the original. */}
      <hemisphereLight
        args={
          photoTexture
            ? ["#ffffff", "#ffffff", 0.16]
            : [room.palette.ceiling, room.palette.floor, 0.5]
        }
        position={[0, height, 0]}
      />
      {/* Ambient carries almost all of the photo-mode budget: it reproduces the
          albedo evenly, so the reconstructed walls match the untouched photo
          across a before/after split instead of reading a stop darker. */}
      <ambientLight intensity={photoTexture ? 0.92 : 0.18} />

      {/* Key light roughly where a window plausibly is — high and to one side.
          Shadow bounds are fitted to the room so the map isn't spent on empty
          space, which is what keeps contact shadows crisp. */}
      <directionalLight
        position={[width * 0.7, height * 1.7, depth * 0.55]}
        intensity={1.35 * k}
        castShadow
        shadow-mapSize-width={IS_TOUCH ? 1024 : 2048}
        shadow-mapSize-height={IS_TOUCH ? 1024 : 2048}
        shadow-bias={-0.0009}
        shadow-normalBias={0.02}
        shadow-camera-near={0.2}
        shadow-camera-far={span * 4}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
      />

      {/* Cool fill from the opposite side so shadowed faces keep some shape */}
      <directionalLight
        position={[-width * 0.8, height * 0.9, -depth * 0.4]}
        intensity={0.32 * k}
        color="#9fb4d0"
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

interface Pose {
  position: Vec3;
  target: Vec3;
}

const ORBIT_FOV_Y = 48;
const FIRST_FOV_Y = 62;

/**
 * Where the camera sits for a given mode.
 *
 * Orbit and top distances are SOLVED against the viewport's aspect rather than
 * hard-coded from the room's dimensions. A fixed multiple of the room depth
 * frames a wide desktop viewport nicely and then strands the room small and
 * low on a tall phone screen, because the horizontal field of view collapses
 * as the canvas narrows. Fitting the room's bounding sphere to whichever axis
 * is tighter gets the same composition on every screen.
 */
function poseFor(mode: CameraMode, room: RoomGeometry, aspect: number): Pose {
  const { width, height, depth } = room.dimensions;
  const fovY = ((mode === "first" ? FIRST_FOV_Y : ORBIT_FOV_Y) * Math.PI) / 180;
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * Math.max(0.2, aspect));

  switch (mode) {
    case "first":
      return {
        position: room.camera.position,
        // Orbiting at a 12cm radius is indistinguishable from turning your
        // head, so first-person reuses the same controls as every other mode.
        target: [
          room.camera.position[0],
          room.camera.position[1] - 0.02,
          room.camera.position[2] - 0.12,
        ],
      };

    case "top": {
      // Fit the floor plan: width against the horizontal fov, depth against
      // the vertical one, whichever needs more height wins.
      const forWidth = width / 2 / Math.tan(fovX / 2);
      const forDepth = depth / 2 / Math.tan(fovY / 2);
      return {
        position: [0, height + Math.max(forWidth, forDepth) * 1.08, 0.001],
        target: [0, 0, 0],
      };
    }

    case "photo":
      return { position: room.camera.position, target: room.camera.target };

    case "orbit":
    default: {
      const centre: Vec3 = [0, height * 0.45, 0];
      const radius = Math.hypot(width, height, depth) / 2;
      // The tighter of the two half-angles decides how far back we must be.
      const distance = (radius / Math.sin(Math.min(fovX, fovY) / 2)) * 0.82;

      // A three-quarter view: enough yaw to read depth, enough pitch to see
      // the floor without looking down on the room like a floor plan.
      const dir: Vec3 = [0.46, 0.38, 1];
      const len = Math.hypot(dir[0], dir[1], dir[2]);

      return {
        position: [
          centre[0] + (dir[0] / len) * distance,
          centre[1] + (dir[1] / len) * distance,
          centre[2] + (dir[2] / len) * distance,
        ],
        target: centre,
      };
    }
  }
}

/**
 * Camera control.
 *
 * Each mode owns the camera outright rather than sharing it. Photo mode needs
 * an exact, asymmetric frustum that reproduces the original shot; orbit, top
 * and first-person need OrbitControls. Running both at once means two writers
 * fighting over the same transform every frame — OrbitControls re-derives the
 * position from its own target and wins, which silently destroys the photo
 * pose. So photo mode unmounts the controls entirely.
 */
function CameraRig({ room }: { room: RoomGeometry }) {
  const mode = useStudio((s) => s.cameraMode);
  if (mode === "photo") return <PhotoRig room={room} />;
  return <OrbitRig room={room} mode={mode} />;
}

function PhotoRig({ room }: { room: RoomGeometry }) {
  const camera = useThree((s) => s.camera) as ThreePerspectiveCamera;
  const size = useThree((s) => s.size);

  // Re-asserted every frame: R3F re-applies its own aspect on resize, and the
  // cost here is a handful of trig operations against the certainty that the
  // view the user is looking at really is the reference one.
  useFrame(() => {
    applyPhotoCamera(camera, room, size.width, size.height);
  });

  React.useLayoutEffect(() => {
    applyPhotoCamera(camera, room, size.width, size.height);
    // Leaving the view offset behind would give the next mode a skewed frustum.
    return () => clearPhotoCamera(camera, size.width, size.height, 48);
  }, [camera, room, size.width, size.height]);

  return null;
}

function OrbitRig({ room, mode }: { room: RoomGeometry; mode: CameraMode }) {
  const interacting = useStudio((s) => s.interacting);
  const camera = useThree((s) => s.camera) as ThreePerspectiveCamera;
  const size = useThree((s) => s.size);

  const controls = React.useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const flight = React.useRef<{ from: Pose; to: Pose; t: number } | null>(null);

  React.useLayoutEffect(() => {
    clearPhotoCamera(
      camera,
      size.width,
      size.height,
      mode === "first" ? FIRST_FOV_Y : ORBIT_FOV_Y,
    );
  }, [camera, size.width, size.height, mode]);

  // Reframe when the canvas aspect changes enough to matter — opening a bottom
  // sheet on a phone halves the viewport, and the old framing would leave the
  // room clipped. Bucketed so a live drag-resize doesn't restart the flight on
  // every pixel.
  const aspectBucket = Math.round((size.width / Math.max(1, size.height)) * 8);

  // Capture where we ARE when the mode changes, so the flight interpolates
  // between two fixed poses and lands exactly on the destination. Easing
  // toward a moving target instead leaves the camera stranded partway when the
  // timer runs out — close enough to look deliberate, wrong enough that
  // "Top view" never actually gets overhead.
  React.useEffect(() => {
    const c = controls.current;
    flight.current = {
      from: {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: c ? [c.target.x, c.target.y, c.target.z] : [0, 0, 0],
      },
      to: poseFor(mode, room, size.width / Math.max(1, size.height)),
      t: 0,
    };
    // size is intentionally read via the bucket so small resizes don't reframe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, room, camera, aspectBucket]);

  useFrame((_, delta) => {
    const f = flight.current;
    if (!f) return;

    f.t = Math.min(1, f.t + delta * 1.7);
    const k = 1 - Math.pow(1 - f.t, 3); // easeOutCubic — exactly 1 at t=1
    const mix = (a: number, b: number) => a + (b - a) * k;

    camera.position.set(
      mix(f.from.position[0], f.to.position[0]),
      mix(f.from.position[1], f.to.position[1]),
      mix(f.from.position[2], f.to.position[2]),
    );

    const c = controls.current;
    if (c) {
      c.target.set(
        mix(f.from.target[0], f.to.target[0]),
        mix(f.from.target[1], f.to.target[1]),
        mix(f.from.target[2], f.to.target[2]),
      );
      c.update();
    } else {
      camera.lookAt(f.to.target[0], f.to.target[1], f.to.target[2]);
    }

    if (f.t >= 1) flight.current = null;
  });

  return (
    <OrbitControls
      ref={controls}
      enabled={!interacting}
      // Any deliberate input cancels the fly-to rather than fighting it.
      onStart={() => {
        flight.current = null;
      }}
      enablePan={mode !== "first"}
      enableZoom={mode !== "first"}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={mode === "first" ? -0.34 : 0.62}
      zoomSpeed={0.7}
      panSpeed={0.7}
      // Close enough to read a figure on a shelf, far enough to see the whole room.
      minDistance={mode === "first" ? 0.08 : 0.12}
      maxDistance={Math.max(room.dimensions.width, room.dimensions.depth) * 5}
      // Pinch and scroll zoom towards what is under the fingers, not the room centre.
      zoomToCursor={mode !== "first"}
      minPolarAngle={mode === "top" ? 0 : 0.12}
      maxPolarAngle={mode === "top" ? 0.35 : Math.PI * 0.92}
      makeDefault
      regress
      // Touch: one finger orbits, two fingers pan and pinch — the pinch-to-zoom
      // and two-finger gestures the brief asks for on mobile.
      touches={{ ONE: 0, TWO: 2 }}
    />
  );
}

/**
 * Keep the canvas's own touch handling switched off.
 *
 * OrbitControls sets `touch-action: none` when it connects — and `auto` when
 * it disconnects. Changing camera mode, or opening a sheet that resizes the
 * view, swaps the controls, and the old instance tearing down last leaves
 * the canvas on `auto`: the phone then treats a pinch as zooming the whole
 * page and a drag as scrolling it, so the room can't be zoomed or turned.
 * Re-asserting it every frame costs one string comparison.
 */
function TouchLock() {
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    const style = gl.domElement.style;
    if (style.touchAction !== "none") style.touchAction = "none";
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* Alignment guides                                                    */
/* ------------------------------------------------------------------ */

function Guides() {
  const draft = useStudio((s) => s.draft);
  const guides = draft?.result?.guides ?? [];
  if (guides.length === 0) return null;

  return (
    <group renderOrder={998}>
      {guides.map((g, i) => {
        const points = new Float32Array([...g.from, ...g.to]);
        return (
          <line key={`${g.axis}-${g.value}-${i}`}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[points, 3]} />
            </bufferGeometry>
            <lineBasicMaterial
              color="#d4ab74"
              transparent
              opacity={0.62}
              depthTest={false}
              toneMapped={false}
            />
          </line>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

function Scene() {
  const room = useStudio((s) => s.room);
  const calibration = useStudio((s) => s.calibration);
  const images = useStudio((s) => s.images);
  const project = useStudio((s) => s.project);
  const items = useStudio((s) => s.items);
  const selectedId = useStudio((s) => s.selectedId);
  const draft = useStudio((s) => s.draft);
  const showOriginal = useStudio((s) => s.showOriginal);
  const photoTexture = useStudio((s) => s.photoTexture);
  const select = useStudio((s) => s.select);
  const beginDraft = useStudio((s) => s.beginDraft);
  const tool = useStudio((s) => s.tool);

  if (!room) return null;

  // Only the first few emissive items get real lights; the rest still glow via
  // their emissive material and bloom, which is visually almost identical and
  // costs nothing per fragment.
  const lightBudget = new Set(
    items
      .filter((i) => productById(i.productId)?.emissive)
      .slice(0, MAX_DYNAMIC_LIGHTS)
      .map((i) => i.id),
  );

  // While an item is being dragged, whatever rests on it rides along with the
  // preview, so you can see the lamp go with the desk before letting go.
  const moving = draft?.itemId ? items.find((i) => i.id === draft.itemId) : undefined;
  const carried =
    moving && draft?.result ? carryDependents(items, moving, { ...draft.result.item, id: moving.id }) : items;
  const visible: PlacedItem[] = showOriginal
    ? []
    : carried.filter((i) => i.id !== draft?.itemId);

  const draftProduct = draft ? productById(draft.productId) : null;

  return (
    <>
      <ProceduralEnvironment room={room} dim={photoTexture} />
      <Lighting room={room} photoTexture={photoTexture} />
      <CameraRig room={room} />
      <DragController />
      <TwistController />

      <RoomShell
        room={room}
        calibration={calibration}
        images={images}
        primaryImageId={project?.images[0]?.id ?? null}
        photoTexture={photoTexture}
      />

      {visible.map((item) => {
        const product = productById(item.productId);
        if (!product) return null;
        return (
          <PlacedObject
            key={item.id}
            item={item}
            product={product}
            selected={item.id === selectedId}
            light={lightBudget.has(item.id)}
            lightScale={photoTexture ? 0.45 : 1}
            onPointerDown={(e, it) => {
              // Pressing on the item that is ALREADY selected picks it up, in
              // any tool: tap to select, then drag to move — the gesture a
              // phone user tries first. A press on anything else only selects,
              // so the camera stays draggable everywhere else.
              // View mode is for looking: the press only steers the camera.
              if (tool === "view") return;
              const wasSelected = useStudio.getState().selectedId === it.id;
              select(it.id);
              if (tool === "move" || wasSelected) {
                (e.target as Element | null)?.releasePointerCapture?.(e.pointerId);
                beginDraft(it.productId, it.id);
              }
            }}
          />
        );
      })}

      {draft?.result && draftProduct ? (
        <group userData={{ ghost: true }}>
          <PlacedObject
            item={draft.result.item}
            product={draftProduct}
            selected={false}
            light={false}
            ghost
            valid={draft.result.valid}
          />
        </group>
      ) : null}

      {/* What a projector lamp actually throws onto the room */}
      <ProjectionPools
        items={visible}
        room={room}
        intensity={photoTexture ? 0.7 : 1}
      />

      <Guides />
      <TouchLock />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

/**
 * Nudge the canvas to re-measure itself.
 *
 * R3F sizes its canvas from a ResizeObserver on the container. If the studio
 * mounts while the page is not painting — opened in a background tab, or a
 * window that is minimised — that observation can come back empty and never
 * repeat, leaving the canvas stuck at its default 300x150 and the 3D view
 * blank until something else happens to resize the window. Re-measuring on
 * mount and whenever the document becomes visible closes that hole.
 */
function useCanvasRemeasure() {
  React.useEffect(() => {
    const ping = () => window.dispatchEvent(new Event("resize"));
    const frame = requestAnimationFrame(ping);
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    // A late ping covers the case where the first frame was also not painted.
    const late = setTimeout(ping, 400);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(late);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

export function Viewport({ className }: { className?: string }) {
  const select = useStudio((s) => s.select);
  useCanvasRemeasure();

  return (
    <Canvas
      className={className}
      shadows
      // Phones have 3x screens; rendering 3D at full density is most of what
      // makes the room stutter there, and past ~1.5x the difference is hard
      // to see on a 6-inch display.
      dpr={[1, IS_TOUCH ? 1.5 : 2]}
      // Lets AdaptiveDpr drop resolution while the camera is moving (see
      // `regress` on the controls) and restore it the moment it stops.
      performance={{ min: 0.5 }}
      gl={{
        antialias: false, // SMAA in the composer handles this more cheaply
        alpha: false,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true, // needed for PNG export
      }}
      camera={{ fov: 48, near: 0.05, far: 120, position: [3, 2, 4] }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.shadowMap.type = PCFSoftShadowMap;
      }}
      onPointerMissed={() => select(null)}
    >
      <color attach="background" args={["#0a0a0c"]} />
      <fog attach="fog" args={["#0a0a0c", 14, 40]} />

      <React.Suspense fallback={null}>
        <Scene />
      </React.Suspense>

      <EffectComposer multisampling={0} enableNormalPass={false}>
        {/* Threshold sits above diffuse white so only genuinely emissive
            surfaces — neon, LED, flames — bloom. */}
        <Bloom
          intensity={0.72}
          luminanceThreshold={0.82}
          luminanceSmoothing={0.28}
          mipmapBlur
          radius={0.72}
        />
        <Vignette offset={0.28} darkness={0.52} />
        <SMAA />
      </EffectComposer>

      <AdaptiveDpr pixelated />
    </Canvas>
  );
}
