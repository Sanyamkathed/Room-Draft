"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Box, Circle, Cylinder, ImagePlus, Link2, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import {
  buildCustomProduct,
  deleteCustomProduct,
  newCustomId,
  safeHttpUrl,
  saveCustomProduct,
} from "@/lib/catalog/custom";
import { fileToDataUrl, prepareCutout } from "@/lib/catalog/customImage";
import type { CustomShape, CustomSpec, CustomStyle, MountType, Product } from "@/lib/catalog/types";
import { Button, Segmented, Spinner } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";
import { PreviewStage } from "./HoverPreview";

/**
 * Make your own decor item — from a link (Pinterest, a shop listing, any page
 * with a product image), a photo you upload, or a plain shape.
 *
 * The result is an ordinary product, saved on this device, that places,
 * snaps, stacks and travels with furniture like anything in the catalog.
 * It is for SEEING decor in your own room — there is no price and no buy
 * link, because a user-made item is not something the app sells.
 * The one thing a picture cannot tell us is how big the object is, and
 * true-to-size is the app's whole promise, so size is asked for up front —
 * with presets, and with the photo's proportions kept for you.
 */

type Source = "link" | "upload" | "shape";
type Dims = { w: number; h: number; d: number };

const MOUNTS: { value: MountType; label: string }[] = [
  { value: "wall", label: "Wall" },
  { value: "tabletop", label: "Table / shelf" },
  { value: "floor", label: "Floor" },
  { value: "ceiling", label: "Ceiling" },
];

const PRESETS: Record<MountType, { label: string; dims: Dims }[]> = {
  wall: [
    { label: "A4 print", dims: { w: 21, h: 29.7, d: 0.3 } },
    { label: "A3 poster", dims: { w: 29.7, h: 42, d: 0.3 } },
    { label: "A2 poster", dims: { w: 42, h: 59.4, d: 0.3 } },
    { label: "Neon sign", dims: { w: 50, h: 30, d: 2.5 } },
    { label: "Large art", dims: { w: 60, h: 90, d: 3 } },
  ],
  tabletop: [
    { label: "Small figure", dims: { w: 8, h: 12, d: 8 } },
    { label: "Figure", dims: { w: 14, h: 24, d: 12 } },
    { label: "Table lamp", dims: { w: 18, h: 35, d: 18 } },
    { label: "Small plant", dims: { w: 14, h: 25, d: 14 } },
    { label: "Photo frame", dims: { w: 15, h: 20, d: 2 } },
  ],
  floor: [
    { label: "Floor plant", dims: { w: 45, h: 90, d: 45 } },
    { label: "Floor lamp", dims: { w: 30, h: 150, d: 30 } },
    { label: "Chair", dims: { w: 60, h: 85, d: 60 } },
    { label: "Side table", dims: { w: 40, h: 50, d: 40 } },
  ],
  edge: [],
  ceiling: [
    { label: "Hanging plant", dims: { w: 25, h: 60, d: 25 } },
    { label: "Pendant lamp", dims: { w: 30, h: 40, d: 30 } },
  ],
};

const STYLES: Record<"wall" | "standing", { value: CustomStyle; label: string; hint: string }[]> = {
  wall: [
    { value: "flat", label: "Flat", hint: "Posters, prints, stickers" },
    { value: "thick", label: "Raised", hint: "Signs, frames, wall art with depth" },
    { value: "sculpted", label: "3D", hint: "Puffed out from the wall — neon tubes, wall lights, relief art" },
  ],
  standing: [
    { value: "sculpted", label: "3D", hint: "A solid, rounded shape built from the photo — looks 3D from every side" },
    { value: "facing", label: "Faces you", hint: "Turns to the camera — never shows a thin edge" },
    { value: "thick", label: "Standee", hint: "A solid cutout with real thickness" },
    { value: "flat", label: "Flat", hint: "A thin card, like a photo print" },
  ],
};

const SHAPES: { value: CustomShape; label: string; icon: React.ReactNode }[] = [
  { value: "box", label: "Box", icon: <Box className="size-3.5" /> },
  { value: "cylinder", label: "Cylinder", icon: <Cylinder className="size-3.5" /> },
  { value: "sphere", label: "Sphere", icon: <Circle className="size-3.5" /> },
];

function cleanTitle(raw?: string): string {
  if (!raw) return "";
  // Pinterest and shops append " | board name" or " - Store"; keep the item.
  return raw.split(/\s[|–—]\s|\s-\s(?=[A-Z])/)[0].trim().slice(0, 80);
}

export function CustomItemDialog({
  initial,
  onClose,
  onSaved,
}: {
  /** Editing an existing item; omit to make a new one. */
  initial?: Product;
  onClose: () => void;
  /** `place` is true when the user chose "Save and place". */
  onSaved: (product: Product, place: boolean) => void;
}) {
  const spec0 = initial?.custom;
  const [source, setSource] = React.useState<Source>(spec0 ? (spec0.image ? "upload" : "shape") : "link");
  const [link, setLink] = React.useState(spec0?.sourceUrl ?? "");
  const [rawImage, setRawImage] = React.useState<string | null>(null);
  const [image, setImage] = React.useState<string | undefined>(spec0?.image);
  const [aspect, setAspect] = React.useState<number | null>(
    initial && spec0?.image ? initial.dims.w / Math.max(1, initial.dims.h) : null,
  );
  const [removeBg, setRemoveBg] = React.useState(true);
  const [busy, setBusy] = React.useState<null | "import" | "cutout">(null);
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);

  const [name, setName] = React.useState(initial?.name ?? "");
  const [mount, setMount] = React.useState<MountType>(initial?.mount ?? "wall");
  const [dims, setDims] = React.useState<Dims>(initial?.dims ?? PRESETS.wall[1].dims);
  const [keepRatio, setKeepRatio] = React.useState(true);
  const [style, setStyle] = React.useState<CustomStyle>(spec0?.style ?? "flat");
  const [shape, setShape] = React.useState<CustomShape>(spec0?.shape ?? "box");
  const [finish, setFinish] = React.useState<NonNullable<CustomSpec["finish"]>>(spec0?.finish ?? "matte");
  const [colour, setColour] = React.useState(initial?.palette[0] ?? "#c9a06a");
  const [glow, setGlow] = React.useState<string | null>(initial?.emissive?.color ?? null);
  const [site, setSite] = React.useState<string | undefined>(spec0?.sourceSite);
  const [sourceUrl, setSourceUrl] = React.useState<string | undefined>(spec0?.sourceUrl);
  const [version, setVersion] = React.useState(() => Date.now());

  const hasImage = source !== "shape" && Boolean(image);

  // Cut the raw picture out again whenever it, or the background toggle, changes.
  React.useEffect(() => {
    if (!rawImage) return;
    let live = true;
    setBusy("cutout");
    setWarning(null);
    prepareCutout(rawImage, removeBg)
      .then((c) => {
        if (!live) return;
        setImage(c.dataUrl);
        setAspect(c.aspect);
        setVersion(Date.now());
        if (removeBg && c.uncertain) {
          setWarning("The background looks busy, so some of it may remain. Product shots on a plain background cut out best.");
        } else if (removeBg && c.littleRemoved) {
          setWarning("Hardly any background was found to remove — that's fine if the picture is already a cutout.");
        }
        // Keep the object's real proportions as the starting size.
        setDims((d) => (keepRatio ? { ...d, w: round(d.h * c.aspect) } : d));
      })
      .catch(() => live && setError("Couldn't process that image."))
      .finally(() => live && setBusy(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawImage, removeBg]);

  // Sensible defaults when the mount changes: a style that suits it, and a size.
  const pickMount = (m: MountType) => {
    setMount(m);
    setStyle(m === "wall" ? "flat" : "sculpted");
    const p = PRESETS[m][m === "wall" ? 1 : 0]?.dims;
    if (p) applyDims(p);
  };

  const applyDims = (p: Dims) => {
    setDims(hasImage && keepRatio && aspect ? { ...p, w: round(p.h * aspect) } : p);
  };

  const setDim = (key: keyof Dims, value: number) => {
    setDims((d) => {
      const next = { ...d, [key]: value };
      if (hasImage && keepRatio && aspect) {
        if (key === "w") next.h = round(value / aspect);
        if (key === "h") next.w = round(value * aspect);
      }
      return next;
    });
  };

  const importLink = async () => {
    const url = safeHttpUrl(link);
    if (!url) {
      setError("Paste a full link starting with https://");
      return;
    }
    setBusy("import");
    setError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      // A platform error (payload too large, function timeout) arrives as
      // plain text, not our JSON, so don't let parsing it be the failure.
      const data = (await res.json().catch(() => ({
        error:
          res.status === 413
            ? "That image is too large to import. Save it and upload it instead."
            : "Couldn't import that link.",
      }))) as {
        error?: string;
        title?: string;
        image?: string;
        site?: string;
        sourceUrl?: string;
      };
      if (!res.ok || !data.image) throw new Error(data.error ?? "Couldn't import that link.");
      // The server only ever returns a raster data URL; refuse anything else.
      if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(data.image)) throw new Error("That link didn't give a usable image.");
      setRawImage(data.image);
      if (!name && data.title) setName(cleanTitle(data.title));
      setSite(data.site);
      setSourceUrl(data.sourceUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't import that link.");
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File) => {
    setError(null);
    try {
      const url = await fileToDataUrl(file);
      setRawImage(url);
      setSite(undefined);
      setSourceUrl(undefined);
      if (!name) setName(file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").slice(0, 60));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    }
  };

  const valid =
    name.trim().length > 0 &&
    [dims.w, dims.h, dims.d].every((v) => Number.isFinite(v) && v >= 0.2 && v <= 600) &&
    (source === "shape" || Boolean(image));

  const draft: Product = React.useMemo(
    () =>
      buildCustomProduct({
        id: initial?.id ?? "custom_draft",
        name: name || "My item",
        mount,
        dims,
        colour,
        glow,
        spec: {
          image: source === "shape" ? undefined : image,
          style: source === "shape" ? "flat" : style,
          shape: source === "shape" ? shape : undefined,
          finish: source === "shape" ? finish : undefined,
          sourceUrl: source === "shape" ? undefined : sourceUrl,
          sourceSite: source === "shape" ? undefined : site,
          createdAt: spec0?.createdAt,
        },
      }),
    [initial?.id, name, mount, dims, colour, glow, source, image, style, shape, finish, sourceUrl, site, spec0?.createdAt],
  );
  // The preview's texture cache is keyed on updatedAt; bump it per new image.
  const previewProduct = React.useMemo(
    () => ({ ...draft, custom: draft.custom ? { ...draft.custom, updatedAt: version } : undefined }),
    [draft, version],
  );

  const save = async (place: boolean) => {
    if (!valid) return;
    const product = { ...draft, id: initial?.id ?? newCustomId() };
    await saveCustomProduct(product);
    onSaved(product, place);
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const styles = STYLES[mount === "wall" ? "wall" : "standing"];

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-0 backdrop-blur-sm md:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label={initial ? "Edit your item" : "Make your own item"}
        onClick={(e) => e.stopPropagation()}
        className="flex h-dvh w-full flex-col overflow-hidden border-white/10 bg-ink-1 md:h-auto md:max-h-[92dvh] md:max-w-[880px] md:rounded-[22px] md:border"
      >
        <header className="flex items-center gap-3 border-b border-white/8 px-5 py-3.5">
          <Sparkles className="size-4 text-accent" />
          <h2 className="flex-1 text-[15px] font-semibold tracking-[-0.02em]">
            {initial ? "Edit your item" : "Make your own item"}
          </h2>
          <button onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-[9px] text-chalk-3 hover:bg-white/8 hover:text-chalk">
            <X className="size-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[1fr_1.15fr]">
          {/* ---------------- Preview ---------------- */}
          <div className="border-b border-white/8 p-4 md:border-b-0 md:border-r">
            <div className="relative h-[240px] overflow-hidden rounded-[16px] bg-[radial-gradient(ellipse_at_50%_40%,#2a2a30_0%,#141417_70%)] md:h-[340px]">
              {source === "shape" || image ? (
                <PreviewStage product={previewProduct} />
              ) : (
                <div className="grid h-full place-items-center px-8 text-center text-[12.5px] leading-relaxed text-chalk-4">
                  Paste a link or upload a photo, and your item appears here in 3D.
                </div>
              )}
              {busy ? (
                <div className="absolute inset-0 grid place-items-center bg-ink-1/60">
                  <div className="flex items-center gap-2 text-[12.5px] text-chalk-2">
                    <Spinner className="size-4" />
                    {busy === "import" ? "Fetching that link…" : "Cutting it out…"}
                  </div>
                </div>
              ) : null}
            </div>
            <p className="mt-2.5 text-[11.5px] tabular-nums text-chalk-4">
              {round(dims.w)} × {round(dims.h)} × {round(dims.d)} cm · shown at true size in your room
            </p>
            {site ? (
              <p className="mt-1 text-[11.5px] text-chalk-4">
                Imported from <span className="text-chalk-3">{site}</span>. For your own room — saved only on this device.
              </p>
            ) : null}
          </div>

          {/* ---------------- Form ---------------- */}
          <div className="space-y-5 p-5">
            <Segmented
              options={[
                { value: "link", label: "Paste a link", icon: <Link2 className="size-3.5" /> },
                { value: "upload", label: "Upload", icon: <ImagePlus className="size-3.5" /> },
                { value: "shape", label: "Shape", icon: <Box className="size-3.5" /> },
              ]}
              value={source}
              onChange={(v) => {
                setSource(v);
                setError(null);
              }}
              size="sm"
              className="w-full [&>button]:flex-1"
            />

            {source === "link" ? (
              <Field label="Link" hint="A Pinterest pin, a shop listing (Amazon, IKEA, Etsy…), or a direct image link.">
                <div className="flex gap-2">
                  <input
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void importLink()}
                    placeholder="https://pin.it/…"
                    inputMode="url"
                    className={inputClass}
                  />
                  <Button variant="primary" size="sm" onClick={() => void importLink()} loading={busy === "import"}>
                    Import
                  </Button>
                </div>
              </Field>
            ) : null}

            {source === "upload" ? (
              <Field label="Photo" hint="A product shot on a plain background cuts out cleanest.">
                <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[11px] border border-dashed border-white/16 text-[12.5px] font-medium text-chalk-3 transition-colors hover:border-accent/45 hover:text-chalk">
                  <ImagePlus className="size-4" />
                  {image ? "Choose a different photo" : "Choose a photo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void onFile(f);
                    }}
                  />
                </label>
              </Field>
            ) : null}

            {source !== "shape" && rawImage ? (
              <label className="flex items-center gap-2 text-[12.5px] text-chalk-2">
                <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} className="accent-[var(--color-accent)]" />
                Remove the background
              </label>
            ) : null}

            {error ? <Notice tone="error">{error}</Notice> : null}
            {warning ? <Notice tone="warn">{warning}</Notice> : null}

            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Pink lightning neon" className={inputClass} />
            </Field>

            <Field label="Where it goes">
              <div className="flex flex-wrap gap-1.5">
                {MOUNTS.map((m) => (
                  <Pill key={m.value} active={mount === m.value} onClick={() => pickMount(m.value)}>
                    {m.label}
                  </Pill>
                ))}
              </div>
            </Field>

            <Field label="Real size (cm)" hint="A picture can't tell us how big something is — this is what makes it true-to-size in your room.">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {PRESETS[mount].map((p) => (
                  <Pill key={p.label} onClick={() => applyDims(p.dims)}>
                    {p.label}
                  </Pill>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["w", "h", "d"] as const).map((k) => (
                  <label key={k} className="block">
                    <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.08em] text-chalk-4">
                      {k === "w" ? "Width" : k === "h" ? "Height" : "Depth"}
                    </span>
                    <input
                      type="number"
                      min={0.2}
                      max={600}
                      step={0.5}
                      value={dims[k]}
                      onChange={(e) => setDim(k, Number(e.target.value))}
                      className={cn(inputClass, "tabular-nums")}
                    />
                  </label>
                ))}
              </div>
              {hasImage ? (
                <label className="mt-2 flex items-center gap-2 text-[12px] text-chalk-3">
                  <input type="checkbox" checked={keepRatio} onChange={(e) => setKeepRatio(e.target.checked)} className="accent-[var(--color-accent)]" />
                  Keep the photo&apos;s proportions
                </label>
              ) : null}
            </Field>

            {source === "shape" ? (
              <>
                <Field label="Shape">
                  <div className="flex flex-wrap gap-1.5">
                    {SHAPES.map((s) => (
                      <Pill key={s.value} active={shape === s.value} onClick={() => setShape(s.value)}>
                        {s.icon}
                        {s.label}
                      </Pill>
                    ))}
                  </div>
                </Field>
                <Field label="Colour and finish">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} aria-label="Colour" className="h-8 w-10 cursor-pointer rounded-[8px] border border-white/12 bg-transparent" />
                    {(["matte", "gloss", "metal", "wood", "fabric"] as const).map((f) => (
                      <Pill key={f} active={finish === f} onClick={() => setFinish(f)}>
                        {f[0].toUpperCase() + f.slice(1)}
                      </Pill>
                    ))}
                  </div>
                </Field>
              </>
            ) : (
              <Field label="How it looks in 3D">
                <div className="grid gap-1.5">
                  {styles.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => setStyle(s.value)}
                      className={cn(
                        "flex items-baseline gap-2 rounded-[11px] border px-3 py-2 text-left transition-colors",
                        style === s.value ? "border-accent/50 bg-accent/8" : "border-white/8 hover:border-white/18",
                      )}
                    >
                      <span className={cn("text-[12.5px] font-semibold", style === s.value ? "text-accent" : "text-chalk")}>{s.label}</span>
                      <span className="text-[11.5px] text-chalk-4">{s.hint}</span>
                    </button>
                  ))}
                </div>
              </Field>
            )}

            <Field label="Glow" hint="For neon, LED and lamps — it lights the room around it.">
              <div className="flex items-center gap-2">
                <Pill active={!glow} onClick={() => setGlow(null)}>
                  Off
                </Pill>
                <Pill active={Boolean(glow)} onClick={() => setGlow(glow ?? "#ff4fa3")}>
                  On
                </Pill>
                {glow ? (
                  <input type="color" value={glow} onChange={(e) => setGlow(e.target.value)} aria-label="Glow colour" className="h-8 w-10 cursor-pointer rounded-[8px] border border-white/12 bg-transparent" />
                ) : null}
              </div>
            </Field>

          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-white/8 px-5 py-3">
          {initial ? (
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                await deleteCustomProduct(initial.id);
                onClose();
              }}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button variant="secondary" size="sm" disabled={!valid || Boolean(busy)} onClick={() => void save(false)}>
            Save to my items
          </Button>
          <Button variant="primary" size="sm" disabled={!valid || Boolean(busy)} onClick={() => void save(true)}>
            Save and place
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function round(v: number) {
  return Math.round(v * 10) / 10;
}

const inputClass =
  "h-9 w-full rounded-[10px] border border-white/10 bg-ink-2 px-3 text-[13px] text-chalk outline-none transition-colors placeholder:text-chalk-4 focus:border-accent/50";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-chalk-3">{label}</p>
      {children}
      {hint ? <p className="mt-1.5 text-[11px] leading-relaxed text-chalk-4">{hint}</p> : null}
    </div>
  );
}

function Pill({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors",
        active ? "border-accent/60 bg-accent text-black" : "border-white/10 text-chalk-2 hover:border-white/25 hover:text-chalk",
      )}
    >
      {children}
    </button>
  );
}

function Notice({ tone, children }: { tone: "error" | "warn"; children: React.ReactNode }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-[11.5px] leading-relaxed", tone === "error" ? "text-danger" : "text-warm")}>
      <TriangleAlert className="mt-0.5 size-3 shrink-0" />
      {children}
    </p>
  );
}
