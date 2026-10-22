"use client";

import * as React from "react";
import { ImagePlus, TriangleAlert, X } from "lucide-react";
import { cutoutToDataUrl, removeBackground } from "@/lib/three/cutout";
import { loadImage } from "@/lib/utils/image";
import { Spinner } from "@/components/ui/primitives";

/**
 * Mount the actual product photo.
 *
 * A procedural model can look plausible; it cannot look like the specific
 * thing you are about to buy. For flat wall decor the seller's own photo,
 * background removed and hung at its real centimetres, IS the item — so this
 * is the shortest honest path to "show me exactly how it will look".
 *
 * Deliberately the user's own image, from the listing they are looking at.
 * The app ships no scraped photography.
 */
export function RealPhotoField({
  current,
  onChange,
}: {
  current?: string;
  onChange: (dataUrl: string | undefined) => void;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [warning, setWarning] = React.useState<string | null>(null);

  const ingest = React.useCallback(
    async (file: File) => {
      setBusy(true);
      setWarning(null);
      try {
        const url = URL.createObjectURL(file);
        try {
          const img = await loadImage(url);
          const result = removeBackground(img);
          if (!result) {
            setWarning("Couldn't read that image.");
            return;
          }
          if (result.uncertain) {
            setWarning(
              "That looks like a room photo rather than a product shot — the cutout may keep some background.",
            );
          } else if (result.removed < 0.04) {
            setWarning(
              "Almost nothing was removed. Product shots on a plain white background work best.",
            );
          }
          onChange(cutoutToDataUrl(result));
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch {
        setWarning("Couldn't process that image.");
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  return (
    <div className="mt-3">
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void ingest(file);
        }}
      />

      {current ? (
        <div className="flex items-center gap-2.5 rounded-[11px] border border-accent/30 bg-accent/8 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current}
            alt="Your product photo"
            className="size-11 shrink-0 rounded-[8px] object-contain"
            style={{
              background:
                "repeating-conic-gradient(#2a2a2e 0% 25%, #1a1a1e 0% 50%) 50% / 10px 10px",
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-accent">Using your photo</p>
            <p className="text-[11px] text-chalk-4">Shown at its real size</p>
          </div>
          <button
            onClick={() => {
              onChange(undefined);
              setWarning(null);
            }}
            aria-label="Remove the photo"
            className="grid size-7 shrink-0 place-items-center rounded-[8px] text-chalk-3 transition-colors hover:bg-white/8 hover:text-danger"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => input.current?.click()}
          disabled={busy}
          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-white/16 text-[12.5px] font-medium text-chalk-3 transition-all hover:border-accent/45 hover:text-chalk disabled:opacity-50"
        >
          {busy ? <Spinner className="size-3.5" /> : <ImagePlus className="size-3.5" />}
          {busy ? "Cutting it out…" : "Use the real product photo"}
        </button>
      )}

      {warning ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-warm">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" />
          {warning}
        </p>
      ) : (
        !current && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-chalk-4">
            Save the image from the listing and drop it in — we remove the white
            background and hang it at its real {""}
            centimetres.
          </p>
        )
      )}
    </div>
  );
}
