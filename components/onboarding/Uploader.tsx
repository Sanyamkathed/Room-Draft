"use client";

import * as React from "react";
import { Camera, ImageIcon, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { prepareImage, type PreparedImage } from "@/lib/utils/image";
import { cn } from "@/lib/utils/cn";

export interface UploadedShot extends PreparedImage {
  id: string;
  name: string;
}

/**
 * Photo intake.
 *
 * Multiple angles are accepted and previewed, but reconstruction runs on the
 * one the user marks as primary — a single well-chosen frame with a visible
 * floor-to-wall junction beats an averaged set, and saying so plainly is more
 * honest than implying the extra shots are being fused.
 */
export function Uploader({
  shots,
  onChange,
  primaryId,
  onPrimary,
}: {
  shots: UploadedShot[];
  onChange: (shots: UploadedShot[]) => void;
  primaryId: string | null;
  onPrimary: (id: string) => void;
}) {
  const [dragOver, setDragOver] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const cameraInput = React.useRef<HTMLInputElement>(null);

  const ingest = React.useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (list.length === 0) {
        setError("Those didn't look like image files.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const prepared = await Promise.all(
          list.slice(0, 6).map(async (file) => ({
            ...(await prepareImage(file)),
            id: `shot_${Math.random().toString(36).slice(2, 9)}`,
            name: file.name,
          })),
        );
        const next = [...shots, ...prepared].slice(0, 6);
        onChange(next);
        if (!primaryId && next.length) onPrimary(next[0].id);
      } catch {
        setError("Couldn't read that image. Try a JPG or PNG.");
      } finally {
        setBusy(false);
      }
    },
    [shots, onChange, primaryId, onPrimary],
  );

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void ingest(e.dataTransfer.files);
        }}
        className={cn(
          "relative overflow-hidden rounded-[var(--radius-card)] border border-dashed transition-all duration-300",
          dragOver
            ? "border-accent/60 bg-accent/5"
            : "border-white/14 bg-ink-1/60 hover:border-white/24",
        )}
      >
        <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
          <div
            className={cn(
              "grid size-14 place-items-center rounded-[16px] transition-all duration-400",
              dragOver ? "bg-accent text-black scale-110" : "bg-white/6 text-chalk-2",
            )}
          >
            <ImageIcon className="size-6" strokeWidth={1.8} />
          </div>

          <div>
            <p className="text-[15px] font-medium tracking-[-0.015em]">
              Drop a photo of your space
            </p>
            <p className="mt-1.5 text-[13px] text-chalk-3">
              Stand in a corner and get the floor and one full wall in frame
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <Button
              variant="primary"
              loading={busy}
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="size-4" strokeWidth={2.2} />
              Choose photo
            </Button>
            <Button variant="outline" onClick={() => cameraInput.current?.click()}>
              <Camera className="size-4" strokeWidth={2} />
              Take one now
            </Button>
          </div>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && void ingest(e.target.files)}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => e.target.files && void ingest(e.target.files)}
        />
      </div>

      {error && (
        <p className="text-[12.5px] text-danger" role="alert">
          {error}
        </p>
      )}

      {shots.length > 0 && (
        <div>
          <p className="mb-2.5 text-[11px] uppercase tracking-[0.1em] text-chalk-3 font-semibold">
            {shots.length === 1
              ? "Your space"
              : "Tap the shot to build your 3D room from"}
          </p>
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
            {shots.map((s) => {
              const isPrimary = s.id === primaryId;
              return (
                <button
                  key={s.id}
                  onClick={() => onPrimary(s.id)}
                  className={cn(
                    "group relative aspect-[4/3] overflow-hidden rounded-[13px] border transition-all duration-300",
                    isPrimary
                      ? "border-accent ring-2 ring-accent/30"
                      : "border-white/10 hover:border-white/25",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.dataUrl} alt={s.name} className="size-full object-cover" />
                  {isPrimary && (
                    <span className="absolute bottom-1.5 left-1.5 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-black">
                      3D SOURCE
                    </span>
                  )}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Remove ${s.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = shots.filter((x) => x.id !== s.id);
                      onChange(next);
                      if (isPrimary && next.length) onPrimary(next[0].id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.stopPropagation();
                      const next = shots.filter((x) => x.id !== s.id);
                      onChange(next);
                      if (isPrimary && next.length) onPrimary(next[0].id);
                    }}
                    className="absolute right-1.5 top-1.5 grid size-6 cursor-pointer place-items-center rounded-full bg-black/70 text-chalk-2 opacity-0 backdrop-blur transition-all hover:text-danger group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
