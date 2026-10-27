"use client";

import * as React from "react";
import { Canvas } from "@react-three/fiber";
import { ACESFilmicToneMapping } from "three";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Camera, Info, RotateCw, X } from "lucide-react";
import { PRODUCTS } from "@/lib/catalog/seed";
import { formatDims, productById } from "@/lib/catalog/source";
import type { Product } from "@/lib/catalog/types";
import { useStudio } from "@/lib/store/studio";
import { downloadDataUrl } from "@/lib/utils/image";
import { Button, Slider, Spinner } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";
import { ProductModel } from "./models/ProductModel";
import { ProductThumb } from "./ProductThumb";

/**
 * AR preview.
 *
 * This composites the product over a live camera feed rather than using
 * WebXR's plane detection, which is a deliberate trade: WebXR immersive-ar
 * exists only on Android Chrome, while getUserMedia works on iOS Safari,
 * desktop and Android alike — and the thing users actually want to answer
 * ("how big is this neon sign really?") is a question of scale, not of plane
 * anchoring. Distance is a control, and the on-screen size is computed from
 * the product's true centimetres at that distance, so the preview is
 * dimensionally honest even though it isn't world-locked.
 */

const AR_FOV = 62;

export function ArMode({ onClose }: { onClose: () => void }) {
  const items = useStudio((s) => s.items);
  const selectedId = useStudio((s) => s.selectedId);

  const inRoom = React.useMemo(() => {
    const seen = new Set<string>();
    return items
      .map((i) => productById(i.productId))
      .filter((p): p is Product => {
        if (!p || seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
  }, [items]);

  const candidates = inRoom.length > 0 ? inRoom : PRODUCTS.filter((p) => p.emissive).slice(0, 8);

  const initial =
    items.find((i) => i.id === selectedId)?.productId ?? candidates[0]?.id ?? PRODUCTS[0].id;

  const [productId, setProductId] = React.useState(initial);
  const [distance, setDistance] = React.useState(2.2);
  const [yaw, setYaw] = React.useState(0);
  const [status, setStatus] = React.useState<"idle" | "ready" | "denied" | "unsupported">("idle");

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);

  const product = productById(productId) ?? PRODUCTS[0];

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unsupported");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("denied");
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Composite the camera frame and the WebGL overlay into one PNG. */
  const capture = React.useCallback(() => {
    const video = videoRef.current;
    const gl = canvasRef.current;
    if (!video || !gl) return;

    const out = document.createElement("canvas");
    out.width = gl.width;
    out.height = gl.height;
    const ctx = out.getContext("2d");
    if (!ctx) return;

    // Cover-fit the video the same way CSS object-cover does on screen, so the
    // saved image matches what the user was looking at.
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw && vh) {
      const scale = Math.max(out.width / vw, out.height / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      ctx.drawImage(video, (out.width - dw) / 2, (out.height - dh) / 2, dw, dh);
    }
    ctx.drawImage(gl, 0, 0, out.width, out.height);

    downloadDataUrl(out.toDataURL("image/png"), `roomdraft-ar-${product.id}.png`);
  }, [product.id]);

  // Height the product occupies on screen at the chosen distance, as a
  // fraction of the viewport — the honest answer to "how big is this?"
  const screenFraction =
    (product.dims.h / 100 / (2 * distance * Math.tan((AR_FOV * Math.PI) / 360))) * 100;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 size-full object-cover"
      />

      {status === "ready" && (
        <Canvas
          className="absolute inset-0"
          gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
          camera={{ fov: AR_FOV, near: 0.05, far: 60, position: [0, 0, 0] }}
          onCreated={({ gl }) => {
            canvasRef.current = gl.domElement;
            gl.toneMapping = ACESFilmicToneMapping;
          }}
        >
          <ambientLight intensity={1.1} />
          <directionalLight position={[2, 4, 3]} intensity={1.5} />
          <directionalLight position={[-3, 1, -2]} intensity={0.5} color="#9fb4d0" />

          {/* Placed on the -Z axis at the chosen distance; the model builds
              itself at true centimetres, so perceived size is physical. */}
          <group position={[0, product.mount === "wall" ? 0 : -0.45, -distance]} rotation={[0, yaw, 0]}>
            <ProductModel product={product} light />
          </group>

          <EffectComposer multisampling={4} enableNormalPass={false}>
            <Bloom intensity={0.6} luminanceThreshold={0.8} mipmapBlur radius={0.7} />
          </EffectComposer>
        </Canvas>
      )}

      {status !== "ready" && (
        <div className="absolute inset-0 grid place-items-center px-8 text-center">
          {status === "idle" ? (
            <div className="flex items-center gap-3 text-chalk-2">
              <Spinner />
              <span className="text-[14px]">Starting your camera…</span>
            </div>
          ) : (
            <div className="max-w-[38ch]">
              <p className="text-[16px] font-medium text-chalk">
                {status === "denied"
                  ? "Camera access was blocked"
                  : "This browser has no camera API"}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-chalk-3">
                {status === "denied"
                  ? "Allow camera access in your browser's site settings, then reopen AR. Everything stays on your device — no frames are uploaded."
                  : "Try opening RoomDraft in Safari or Chrome on a phone."}
              </p>
              <Button variant="secondary" className="mt-6" onClick={onClose}>
                Back to the studio
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ---------------- Chrome ---------------- */}
      <header className="relative z-10 flex h-[60px] shrink-0 items-center justify-between gap-3 px-4">
        <div className="rounded-full glass-strong px-3 py-1.5">
          <p className="text-[12.5px] font-semibold tracking-[-0.01em] text-chalk">
            {product.name}
          </p>
          <p className="text-[10.5px] tabular-nums text-chalk-3">{formatDims(product)}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close AR"
          className="grid size-10 place-items-center rounded-full glass-strong text-chalk"
        >
          <X className="size-4.5" />
        </button>
      </header>

      <div className="flex-1" />

      {status === "ready" && (
        <div className="relative z-10 space-y-3 px-4 pb-6">
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {candidates.map((p) => (
              <button
                key={p.id}
                onClick={() => setProductId(p.id)}
                className={cn(
                  "shrink-0 rounded-[14px] p-1 transition-all",
                  p.id === productId ? "bg-accent" : "bg-black/40 backdrop-blur",
                )}
              >
                <ProductThumb product={p} className="size-12" />
              </button>
            ))}
          </div>

          <div className="rounded-[var(--radius-panel)] glass-strong p-4 edge-light">
            <Slider
              label="Distance from you"
              value={distance}
              min={0.6}
              max={6}
              step={0.05}
              format={(v) => `${v.toFixed(1)} m`}
              onChange={setDistance}
            />

            <p className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-chalk-4">
              <Info className="mt-0.5 size-3 shrink-0" />
              At {distance.toFixed(1)} m this fills about {Math.round(screenFraction)}% of
              your screen height — that&apos;s its real {product.dims.h} cm.
            </p>

            <div className="mt-4 flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setYaw((y) => y + Math.PI / 8)}
                className="flex-1"
              >
                <RotateCw className="size-3.5" />
                Turn
              </Button>
              <Button variant="primary" size="sm" onClick={capture} className="flex-1">
                <Camera className="size-3.5" />
                Capture
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
