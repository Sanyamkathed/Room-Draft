"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Armchair,
  Box,
  Check,
  Circle,
  ClipboardPaste,
  Cylinder,
  Frame,
  ImagePlus,
  Lamp,
  Link2,
  Pencil,
  RectangleHorizontal,
  ScanFace,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  buildCustomProduct,
  deleteCustomProduct,
  newCustomId,
  safeHttpUrl,
  saveCustomProduct,
} from "@/lib/catalog/custom";
import { fileToDataUrl, prepareCutout } from "@/lib/catalog/customImage";
import { estimateDepth } from "@/lib/catalog/depth";
import { coloursFrom, guessFrame, guessTemplate, type ItemColours } from "@/lib/catalog/appearance";
import { GenerateError, generateModel, quotaResetAt, type GenerateStatus } from "@/lib/catalog/imageTo3d";
import type { CustomShape, CustomSpec, CustomStyle, CustomTemplate, MountType, Product } from "@/lib/catalog/types";
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
 * true-to-size is the app's whole promise, so size is asked for before it
 * can be saved — with presets, and with the photo's proportions kept.
 *
 * It asks one question at a time, like a short form: where's the picture
 * from → is this the item → what is it → how big → finishing touches. Each
 * next question appears once the previous one is answered; answered ones
 * fold into a one-line summary that can be tapped to change.
 */

type Source = "link" | "upload" | "shape";
type Dims = { w: number; h: number; d: number };

/** Where it goes, as the user thinks of it. A rug is a floor item that lies flat. */
type Kind = MountType | "rug";

/** "What is it?" — answered in the user's words, mapped to how it mounts. */
type Choice = Kind | "mirror";
const CHOICES: { value: Choice; label: string; hint: string; icon: React.ReactNode }[] = [
  { value: "tabletop", label: "Decor", hint: "Figures, plants, lamps — goes on a table or shelf", icon: <ScanFace className="size-4" /> },
  { value: "floor", label: "Furniture", hint: "Sofas, chairs, floor lamps — stands on the floor", icon: <Armchair className="size-4" /> },
  { value: "wall", label: "Wall art", hint: "Posters, prints, neon, wall lights", icon: <Frame className="size-4" /> },
  { value: "mirror", label: "Mirror", hint: "The glass will reflect your room", icon: <Circle className="size-4" /> },
  { value: "rug", label: "Rug or mat", hint: "Lies flat; things stand on it", icon: <RectangleHorizontal className="size-4" /> },
  { value: "ceiling", label: "Hanging", hint: "Pendant lamps, hanging plants", icon: <Lamp className="size-4" /> },
];

const PRESETS: Record<Kind, { label: string; dims: Dims }[]> = {
  rug: [
    { label: "Bath mat", dims: { w: 40, h: 1, d: 60 } },
    { label: "Small rug", dims: { w: 90, h: 1, d: 150 } },
    { label: "Rug", dims: { w: 160, h: 1.2, d: 230 } },
    { label: "Large rug", dims: { w: 200, h: 1.2, d: 300 } },
    { label: "Runner", dims: { w: 70, h: 1, d: 200 } },
    { label: "Round", dims: { w: 120, h: 1, d: 120 } },
  ],
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

type TplKind = CustomTemplate["kind"];
const TPL_PRESETS: Record<TplKind | "mirror-floor", { label: string; dims: Dims }[]> = {
  sofa: [
    { label: "2-seater", dims: { w: 180, h: 85, d: 90 } },
    { label: "3-seater", dims: { w: 220, h: 85, d: 95 } },
    { label: "Loveseat", dims: { w: 150, h: 85, d: 85 } },
  ],
  armchair: [{ label: "Armchair", dims: { w: 80, h: 85, d: 82 } }],
  table: [
    { label: "Coffee table", dims: { w: 110, h: 45, d: 60 } },
    { label: "Side table", dims: { w: 45, h: 55, d: 45 } },
    { label: "Dining table", dims: { w: 160, h: 75, d: 90 } },
    { label: "Desk", dims: { w: 120, h: 75, d: 60 } },
  ],
  mirror: [
    { label: "Wall mirror", dims: { w: 60, h: 90, d: 3 } },
    { label: "Round 60", dims: { w: 60, h: 60, d: 3 } },
  ],
  "mirror-floor": [
    { label: "Full length", dims: { w: 55, h: 160, d: 35 } },
    { label: "Wide", dims: { w: 80, h: 180, d: 38 } },
  ],
};
const FRAMES: { label: string; colour: string }[] = [
  { label: "Black", colour: "#1b1b1d" },
  { label: "Gold", colour: "#c9a24a" },
  { label: "Silver", colour: "#b8bcc2" },
  { label: "Wood", colour: "#9a6a3e" },
  { label: "White", colour: "#ecebe7" },
];

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
  initialLink,
  initialName,
  onClose,
  onSaved,
}: {
  /** Editing an existing item; omit to make a new one. */
  initial?: Product;
  /** A link to import straight away, e.g. a Pin picked in the inspo feed. */
  initialLink?: string;
  /** A name to start from when the link itself carries none. */
  initialName?: string;
  onClose: () => void;
  /** `place` is true when the user chose "Save and place". */
  onSaved: (product: Product, place: boolean) => void;
}) {
  const spec0 = initial?.custom;
  const [source, setSource] = React.useState<Source>(spec0 ? (spec0.image ? "upload" : "shape") : "link");
  const [link, setLink] = React.useState(spec0?.sourceUrl ?? initialLink ?? "");
  const [rawImage, setRawImage] = React.useState<string | null>(null);
  const [image, setImage] = React.useState<string | undefined>(spec0?.image);
  const [aspect, setAspect] = React.useState<number | null>(
    initial && spec0?.image ? initial.dims.w / Math.max(1, initial.dims.h) : null,
  );
  const [removeBg, setRemoveBg] = React.useState(true);
  // Keep just the photo's subject when the cutout finds several objects.
  const [mainOnly, setMainOnly] = React.useState(true);
  const [others, setOthers] = React.useState(0);
  const [busy, setBusy] = React.useState<null | "import" | "cutout">(null);
  // Depth for the 3D shape, worked out after the cutout (see lib/catalog/depth.ts).
  const [depth, setDepth] = React.useState<string | undefined>(spec0?.depth);
  const [shaping, setShaping] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);

  const [name, setName] = React.useState(initial?.name ?? cleanTitle(initialName));
  const [kind, setKind] = React.useState<Kind>(
    spec0?.style === "rug" ? "rug" : (initial?.mount ?? "wall"),
  );
  const mount: MountType = kind === "rug" ? "floor" : kind;
  const isRug = kind === "rug";
  // A rug's photo is seen from above, so its proportions are width × depth.
  const isRugRef = React.useRef(isRug);
  isRugRef.current = isRug;
  const [dims, setDims] = React.useState<Dims>(initial?.dims ?? PRESETS.wall[1].dims);
  // A mirror's glass reflects; found from the frame that encloses it.
  const [isMirror, setIsMirror] = React.useState(Boolean(spec0?.glass));
  const [glass, setGlass] = React.useState<string | undefined>(spec0?.glass);
  // Other things can be set down on it — a side table, a stool, a rug.
  const [holds, setHolds] = React.useState<boolean>(initial?.stackable ?? false);
  const [keepRatio, setKeepRatio] = React.useState(true);
  const [style, setStyle] = React.useState<CustomStyle>(spec0?.style ?? "flat");
  const [shape, setShape] = React.useState<CustomShape>(spec0?.shape ?? "box");
  const [finish, setFinish] = React.useState<NonNullable<CustomSpec["finish"]>>(spec0?.finish ?? "matte");
  const [colour, setColour] = React.useState(initial?.palette[0] ?? "#c9a06a");
  const [glow, setGlow] = React.useState<string | null>(initial?.emissive?.color ?? null);
  const [site, setSite] = React.useState<string | undefined>(spec0?.sourceSite);
  const [sourceUrl, setSourceUrl] = React.useState<string | undefined>(spec0?.sourceUrl);
  const [version, setVersion] = React.useState(() => Date.now());

  // Which questions are answered. Editing an item starts with all of them done.
  const [confirmed, setConfirmed] = React.useState(Boolean(initial));
  const [kindChosen, setKindChosen] = React.useState(Boolean(initial));
  const [sized, setSized] = React.useState(Boolean(initial));
  const [editing, setEditing] = React.useState<null | "source" | "item" | "kind" | "method" | "model" | "size">(null);
  const [showLook, setShowLook] = React.useState(false);

  // A matched 3D model for furniture and mirrors (see models/templates.tsx).
  const tpl0 = spec0?.template;
  const [tpl, setTpl] = React.useState<TplKind | null>(tpl0?.kind ?? null);
  const [modelChosen, setModelChosen] = React.useState(Boolean(initial));
  const [seats, setSeats] = React.useState<CustomTemplate["seats"]>(tpl0?.seats);
  const [arms, setArms] = React.useState<NonNullable<CustomTemplate["arms"]>>(tpl0?.arms ?? "square");
  const [tShape, setTShape] = React.useState<NonNullable<CustomTemplate["shape"]>>(tpl0?.shape ?? "rounded");
  const [tBase, setTBase] = React.useState<NonNullable<CustomTemplate["base"]>>(tpl0?.base ?? "legs");
  const [frameColour, setFrameColour] = React.useState(tpl0?.kind === "mirror" ? tpl0.colours[0] : "#1b1b1d");
  // How it's built: the item itself generated in 3D, a matched model, or
  // quick relief from the photo's outline.
  const [method, setMethod] = React.useState<null | "exact" | "matched" | "quick">(
    initial ? (spec0?.mesh ? "exact" : spec0?.template ? "matched" : "quick") : null,
  );
  const [mesh, setMesh] = React.useState<string | undefined>(spec0?.mesh);
  const [meshSize, setMeshSize] = React.useState<[number, number, number] | null>(
    spec0?.mesh && initial ? [initial.dims.w, initial.dims.h, initial.dims.d] : null,
  );
  const [generating, setGenerating] = React.useState<string | null>(null);
  const [genError, setGenError] = React.useState<{ message: string; quota: boolean; resetAt?: number } | null>(null);
  const genAbort = React.useRef<AbortController | null>(null);
  // Read once per open: whether the free 3D time is already used up today.
  const [exactResetAt] = React.useState(() => quotaResetAt());
  React.useEffect(() => () => genAbort.current?.abort(), []);
  const [photoColours, setPhotoColours] = React.useState<ItemColours | null>(
    tpl0 ? { main: tpl0.colours[0], dark: tpl0.colours[1], light: tpl0.colours[2] } : null,
  );

  const hasImage = source !== "shape" && Boolean(image);

  // Cut the raw picture out again whenever it, or the background toggle, changes.
  React.useEffect(() => {
    if (!rawImage) return;
    let live = true;
    setBusy("cutout");
    setWarning(null);
    prepareCutout(rawImage, removeBg, mainOnly, isMirror)
      .then((c) => {
        if (!live) return;
        setOthers(c.others);
        setImage(c.dataUrl);
        setDepth(undefined);
        if (removeBg) {
          setShaping(true);
          estimateDepth(c.dataUrl)
            .then((dm) => live && dm && setDepth(dm))
            .finally(() => live && setShaping(false));
        }
        setGlass(c.glass);
        setAspect(c.aspect);
        void coloursFrom(c.dataUrl).then((cl) => live && cl && setPhotoColours(cl));
        setVersion(Date.now());
        if (removeBg && c.uncertain) {
          setWarning("The background looks busy, so some of it may remain. Product shots on a plain background cut out best.");
        } else if (removeBg && c.littleRemoved) {
          setWarning("Hardly any background was found to remove — that's fine if the picture is already a cutout.");
        }
        // Keep the object's real proportions as the starting size.
        setDims((d) =>
          !keepRatio ? d : isRugRef.current ? { ...d, d: round(d.w / c.aspect) } : { ...d, w: round(d.h * c.aspect) },
        );
      })
      .catch(() => live && setError("Couldn't process that image."))
      .finally(() => live && setBusy(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawImage, removeBg, mainOnly, isMirror]);

  // Sensible defaults when the kind changes: a style that suits it, and a size.
  const pickKind = (k: Kind, mirror = false) => {
    setKind(k);
    isRugRef.current = k === "rug";
    setStyle(k === "rug" ? "rug" : k === "wall" && !mirror ? "flat" : "sculpted");
    setHolds(k === "rug" || k === "floor");
    const p = PRESETS[k][k === "wall" || k === "rug" ? 1 : 0]?.dims;
    if (p) applyDims(p, k === "rug");
  };

  const applyDims = (p: Dims, rug = isRug) => {
    if (!(hasImage && keepRatio && aspect)) return setDims(p);
    setDims(rug ? { ...p, d: round(p.w / aspect) } : { ...p, w: round(p.h * aspect) });
  };

  // The photo's proportions tie width to height — or, for a rug, to depth.
  const setDim = (key: keyof Dims, value: number) => {
    setDims((d) => {
      // A generated model keeps all three proportions together.
      if (method === "exact" && meshSize && keepRatio && d[key] > 0) {
        const f = value / d[key];
        return { w: round(d.w * f), h: round(d.h * f), d: round(d.d * f) };
      }
      const next = { ...d, [key]: value };
      if (hasImage && keepRatio && aspect) {
        const other = isRug ? "d" : "h";
        if (key === "w") next[other] = round(value / aspect);
        if (key === other) next.w = round(value * aspect);
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
      setConfirmed(false);
      setEditing(null);
      if (!name && data.title) setName(cleanTitle(data.title));
      const fr = guessFrame(data.title ?? "");
      if (fr) setFrameColour(fr);
      setSite(data.site);
      setSourceUrl(data.sourceUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't import that link.");
    } finally {
      setBusy(null);
    }
  };

  // A Pin handed over from the inspo feed starts importing as the dialog opens.
  const autoImported = React.useRef(false);
  React.useEffect(() => {
    if (!initialLink || initial || autoImported.current) return;
    autoImported.current = true;
    void importLink();
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFile = async (file: File) => {
    setError(null);
    try {
      const url = await fileToDataUrl(file);
      setRawImage(url);
      setConfirmed(false);
      setEditing(null);
      setSite(undefined);
      setSourceUrl(undefined);
      if (!name) setName(file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").slice(0, 60));
      const fr = guessFrame(file.name);
      if (fr) setFrameColour(fr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    }
  };

  const valid =
    sized &&
    name.trim().length > 0 &&
    [dims.w, dims.h, dims.d].every((v) => Number.isFinite(v) && v >= 0.2 && v <= 600) &&
    (source === "shape" || Boolean(image) || Boolean(tpl)) &&
    (method !== "exact" || Boolean(mesh));

  const template: CustomTemplate | null = React.useMemo(() => {
    if (!tpl) return null;
    const c = photoColours ?? { main: "#b9b2a8", dark: "#2a2622", light: "#e7e2da" };
    return {
      kind: tpl,
      colours: tpl === "mirror" ? [frameColour, frameColour, frameColour] : [c.main, c.dark, c.light],
      seats: tpl === "sofa" ? seats : undefined,
      arms: tpl === "sofa" || tpl === "armchair" ? arms : undefined,
      shape: tpl === "mirror" || tpl === "table" ? tShape : undefined,
      base: tpl === "table" ? tBase : undefined,
    };
  }, [tpl, photoColours, frameColour, seats, arms, tShape, tBase]);

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
          glass: source !== "shape" && isMirror && !isRug ? glass : undefined,
          depth: source !== "shape" && removeBg && !isRug ? depth : undefined,
          holds: mount === "wall" || mount === "ceiling" ? undefined : isRug || holds || (method === "matched" && tpl !== null && tpl !== "mirror"),
          style: isRug ? "rug" : source === "shape" ? "flat" : style,
          template: method === "matched" ? (template ?? undefined) : undefined,
          mesh: method === "exact" ? mesh : undefined,
          shape: source === "shape" ? shape : undefined,
          finish: source === "shape" ? finish : undefined,
          sourceUrl: source === "shape" ? undefined : sourceUrl,
          sourceSite: source === "shape" ? undefined : site,
          createdAt: spec0?.createdAt,
        },
      }),
    [initial?.id, name, mount, isRug, holds, isMirror, glass, depth, template, tpl, method, mesh, dims, colour, glow, source, image, style, shape, finish, sourceUrl, site, spec0?.createdAt],
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
  const sourceDone = source === "shape" || Boolean(image);
  const hasPreview = source === "shape" || Boolean(image);
  const currentChoice: Choice = isMirror || tpl === "mirror" ? "mirror" : kind;
  // Furniture and mirrors get a "which one?" step, offering a matched model.
  // Photos of things with a real shape can be built three ways; rugs and
  // wall art are flat, so the photo itself is the right answer.
  const offersExact = source !== "shape" && kindChosen && currentChoice !== "rug" && currentChoice !== "wall";
  const offersMatched = currentChoice === "floor" || currentChoice === "mirror";
  const methodReady = !offersExact || method !== null;
  const needsModel = kindChosen && methodReady && method === "matched";
  const modelReady = !needsModel || modelChosen;
  const photoPath = source !== "shape" && methodReady && method !== "matched";
  const meshReady = method !== "exact" || Boolean(mesh);

  const startGenerate = async () => {
    if (!image) return;
    genAbort.current?.abort();
    const ac = new AbortController();
    genAbort.current = ac;
    setGenError(null);
    setMesh(undefined);
    setGenerating("Sending the photo…");
    try {
      const blob = await (await fetch(removeBg ? image : (rawImage ?? image))).blob();
      const label = (st: GenerateStatus) =>
        st.stage === "upload"
          ? "Sending the photo…"
          : st.stage === "queue"
            ? `Waiting for a free GPU · #${st.position} in line`
            : st.stage === "building"
              ? "Building the 3D model…"
              : "Almost there…";
      const m = await generateModel(blob, (st) => setGenerating(label(st)), ac.signal);
      // Start from a typical height for what it is, in the model's own proportions.
      const guess = guessTemplate(name);
      const baseH = guess && guess !== "mirror" ? TPL_PRESETS[guess][0].dims.h : dims.h;
      setMesh(m.dataUrl);
      setMeshSize(m.size);
      setVersion(Date.now());
      setKeepRatio(true);
      setDims({ w: round((baseH * m.size[0]) / m.size[1]), h: baseH, d: round((baseH * m.size[2]) / m.size[1]) });
    } catch (e) {
      if (!ac.signal.aborted) {
        setGenError({
          message: e instanceof GenerateError ? e.message : "The 3D service couldn't be reached.",
          quota: e instanceof GenerateError && e.quota,
          resetAt: e instanceof GenerateError ? e.resetAt : undefined,
        });
      }
    } finally {
      if (genAbort.current === ac) setGenerating(null);
    }
  };
  const chooseModel = (k: TplKind | null) => {
    setTpl(k);
    setModelChosen(true);
    if (!k) setMethod("quick");
    setIsMirror(false);
    setSized(false);
    setEditing(null);
    setKeepRatio(!k);
    if (k) {
      const list = TPL_PRESETS[k === "mirror" && kind === "floor" ? "mirror-floor" : k];
      setDims(list[0].dims);
      if (k === "table" && (list[0].dims.w < 60)) setTShape("round");
    }
  };
  const modelSummary =
    tpl === "sofa"
      ? `Sofa · ${seats ?? "auto"} seats · ${arms} arms`
      : tpl === "armchair"
        ? `Armchair · ${arms} arms`
        : tpl === "table"
          ? `Table · ${tShape === "round" ? "round" : "rectangular"} · ${tBase}`
          : tpl === "mirror"
            ? `Mirror · ${tShape} · ${FRAMES.find((f) => f.colour === frameColour)?.label ?? "custom"} frame · ${kind === "floor" ? "standing" : "on the wall"}`
            : isMirror
              ? "Mirror · from the photo"
              : "From the photo";
  const choiceLabel = CHOICES.find((c) => c.value === currentChoice)?.label ?? "Decor";
  const canPaste = typeof navigator !== "undefined" && Boolean(navigator.clipboard?.readText);

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

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* ---------------- Preview ---------------- */}
          <div className={cn("border-b border-white/8 p-4 md:border-b-0 md:border-r", !hasPreview && "hidden md:block")}>
            <div className="relative h-[220px] overflow-hidden rounded-[16px] bg-[radial-gradient(ellipse_at_50%_40%,#2a2a30_0%,#141417_70%)] md:h-[340px]">
              {hasPreview ? (
                <PreviewStage product={previewProduct} />
              ) : (
                <div className="grid h-full place-items-center px-8 text-center text-[12.5px] leading-relaxed text-chalk-4">
                  Your item appears here in 3D.
                </div>
              )}
              {busy ? (
                <div className="absolute inset-0 grid place-items-center bg-ink-1/60">
                  <div className="flex items-center gap-2 text-[12.5px] text-chalk-2">
                    <Spinner className="size-4" />
                    {busy === "import" ? "Fetching that link…" : "Finding the product…"}
                  </div>
                </div>
              ) : shaping ? (
                <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 text-[11px] text-chalk-2 backdrop-blur">
                  <Spinner className="size-3" />
                  Shaping it in 3D…
                </div>
              ) : null}
            </div>
            {hasPreview ? (
              <p className="mt-2.5 text-[11.5px] tabular-nums text-chalk-4">
                {round(dims.w)} × {round(dims.h)} × {round(dims.d)} cm{sized ? " · true size in your room" : ""}
              </p>
            ) : null}
            {site ? (
              <p className="mt-1 text-[11.5px] text-chalk-4">
                Imported from <span className="text-chalk-3">{site}</span>. For your own room — saved only on this device.
              </p>
            ) : null}
          </div>

          {/* ---------------- Questions, one after another ---------------- */}
          <div className="space-y-3 p-4 md:p-5">
            {/* 1 · Where's it from? */}
            {sourceDone && editing !== "source" ? (
              <Answered
                q="Picture"
                a={source === "shape" ? "A plain shape" : site ? `From ${site}` : source === "link" ? "From a link" : "Your photo"}
                onChange={() => setEditing("source")}
              />
            ) : (
              <Question n={1} q="Where's your item from?">
                <Segmented
                  options={[
                    { value: "link", label: "Link", icon: <Link2 className="size-3.5" /> },
                    { value: "upload", label: "Photo", icon: <ImagePlus className="size-3.5" /> },
                    { value: "shape", label: "Shape", icon: <Box className="size-3.5" /> },
                  ]}
                  value={source}
                  onChange={(v) => {
                    setSource(v);
                    setError(null);
                    if (v === "shape") {
                      setEditing(null);
                      setConfirmed(true);
                    }
                  }}
                  size="sm"
                  className="w-full [&>button]:flex-1"
                />
                {source === "link" ? (
                  <div className="mt-3 rounded-[14px] border border-accent/30 bg-accent/5 p-3">
                    <p className="mb-2 text-[12px] text-chalk-2">Paste a Pinterest pin, a shop listing, or an image link</p>
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void importLink()}
                        placeholder="https://pin.it/…"
                        inputMode="url"
                        className={inputClass}
                      />
                      {canPaste ? (
                        <button
                          type="button"
                          aria-label="Paste link"
                          onClick={async () => {
                            const t = await navigator.clipboard.readText().catch(() => "");
                            if (t) setLink(t.trim());
                          }}
                          className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-white/10 text-chalk-3 hover:text-chalk"
                        >
                          <ClipboardPaste className="size-4" />
                        </button>
                      ) : null}
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      className="mt-2.5 w-full"
                      onClick={() => void importLink()}
                      loading={busy === "import"}
                      disabled={!link.trim()}
                    >
                      Find the item
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
                {source === "upload" ? (
                  <label className="mt-3 flex h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-white/16 text-[12.5px] font-medium text-chalk-3 transition-colors hover:border-accent/45 hover:text-chalk">
                    <ImagePlus className="size-5" />
                    {image ? "Choose a different photo" : "Choose a photo"}
                    <span className="text-[11px] font-normal text-chalk-4">A product on a plain background cuts out cleanest</span>
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
                ) : null}
              </Question>
            )}

            {error ? <Notice tone="error">{error}</Notice> : null}

            {/* 2 · What is it? */}
            {sourceDone && editing !== "source" ? (
              kindChosen && editing !== "kind" ? (
                <Answered q="It's" a={choiceLabel} onChange={() => setEditing("kind")} />
              ) : (
                <Question n={2} q="What is it?">
                  <div className="grid grid-cols-2 gap-1.5">
                    {CHOICES.filter((c) => source !== "shape" || c.value !== "mirror").map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => {
                          const mirror = c.value === "mirror";
                          const k: Kind = mirror ? (kind === "floor" ? "floor" : "wall") : (c.value as Kind);
                          pickKind(k, mirror);
                          setKindChosen(true);
                          setEditing(null);
                          setSized(false);
                          setIsMirror(false);
                          setRemoveBg(true);
                          setMethod(c.value === "rug" || c.value === "wall" || source === "shape" ? "quick" : null);
                          setMesh(undefined);
                          setGenError(null);
                          // Furniture and mirrors pick a model next; the rest is built from the photo.
                          const guess = guessTemplate(name);
                          if (mirror) {
                            setTpl("mirror");
                            setModelChosen(false);
                          } else if (c.value === "floor" && source !== "shape") {
                            setTpl(guess && guess !== "mirror" ? guess : null);
                            setModelChosen(false);
                          } else {
                            setTpl(null);
                            setModelChosen(true);
                          }
                        }}
                        className={cn(
                          "flex flex-col items-start gap-1 rounded-[12px] border p-2.5 text-left transition-colors",
                          currentChoice === c.value && kindChosen ? "border-accent/55 bg-accent/8" : "border-white/8 hover:border-white/20",
                        )}
                      >
                        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-chalk">
                          {c.icon}
                          {c.label}
                        </span>
                        <span className="text-[11px] leading-snug text-chalk-4">{c.hint}</span>
                      </button>
                    ))}
                  </div>
                </Question>
              )
            ) : null}

            {/* 3 · How should it be built? */}
            {offersExact && editing !== "kind" ? (
              method && editing !== "method" ? (
                <Answered
                  q="Built as"
                  a={method === "exact" ? "Exact 3D model" : method === "matched" ? "Matched model" : "Quick 3D from the photo"}
                  onChange={() => setEditing("method")}
                />
              ) : (
                <Question n={3} q="How should we build it in 3D?">
                  <div className="grid gap-1.5">
                    <Choice
                      active={method === "exact"}
                      title="Exact 3D model · recommended"
                      hint={
                        exactResetAt
                          ? `Today's free 3D time on this device is used up — back in ${untilText(exactResetAt)}.`
                          : "Your actual item in full 3D, made by a free AI service in about 30 seconds. The photo is sent to Hugging Face to do this."
                      }
                      onClick={() => {
                        setMethod("exact");
                        setEditing(null);
                        setSized(false);
                      }}
                    />
                    {offersMatched ? (
                      <Choice
                        active={method === "matched"}
                        title={currentChoice === "mirror" ? "Matched mirror" : "Matched model"}
                        hint={
                          currentChoice === "mirror"
                            ? "A clean mirror in your shape and frame — its glass reflects your room. Instant, offline."
                            : "A clean sofa, armchair or table in your photo's colours. Instant, offline."
                        }
                        onClick={() => {
                          setMethod("matched");
                          setModelChosen(false);
                          setEditing(null);
                          setSized(false);
                        }}
                      />
                    ) : null}
                    <Choice
                      active={method === "quick"}
                      title="Quick 3D from the photo"
                      hint="Instant and offline; looks best from the front."
                      onClick={() => {
                        setMethod("quick");
                        if (tpl) setTpl(null);
                        setEditing(null);
                        setSized(false);
                      }}
                    />
                  </div>
                </Question>
              )
            ) : null}

            {/* 3 · Which one? — a matched 3D model for furniture and mirrors */}
            {needsModel && editing !== "kind" && editing !== "method" ? (
              modelChosen && editing !== "model" ? (
                <Answered q="Model" a={modelSummary} onChange={() => setEditing("model")} />
              ) : currentChoice === "mirror" ? (
                <Question n={4} q="Tell us about the mirror" sub="It's built as a real mirror that reflects your room.">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-chalk-3">Where</p>
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    <Pill active={kind === "wall"} onClick={() => pickKind("wall", true)}>On the wall</Pill>
                    <Pill active={kind === "floor"} onClick={() => pickKind("floor", true)}>Standing on the floor</Pill>
                  </div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-chalk-3">Shape</p>
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {(["rounded", "rect", "arch", "round"] as const).map((sh) => (
                      <Pill key={sh} active={tShape === sh} onClick={() => setTShape(sh)}>
                        {sh === "rounded" ? "Rounded corners" : sh === "rect" ? "Rectangle" : sh === "arch" ? "Arch" : "Round / oval"}
                      </Pill>
                    ))}
                  </div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-chalk-3">Frame</p>
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {FRAMES.map((f) => (
                      <Pill key={f.label} active={frameColour === f.colour} onClick={() => setFrameColour(f.colour)}>
                        <span className="size-3 rounded-full border border-white/20" style={{ background: f.colour }} />
                        {f.label}
                      </Pill>
                    ))}
                  </div>
                  <Button variant="primary" size="sm" className="w-full" onClick={() => chooseModel("mirror")}>
                    Use this mirror
                    <ArrowRight className="size-3.5" />
                  </Button>
                  {source !== "shape" ? (
                    <button
                      type="button"
                      onClick={() => {
                        chooseModel(null);
                        setIsMirror(true);
                      }}
                      className="mt-2 w-full text-center text-[11.5px] text-chalk-4 underline-offset-2 hover:text-chalk-2 hover:underline"
                    >
                      Unusual shape (wavy, sculpted)? Build it from the photo instead
                    </button>
                  ) : null}
                </Question>
              ) : (
                <Question n={4} q="Which piece of furniture?" sub="Sofas, armchairs and tables are built as real 3D models in your photo's colours.">
                  <div className="grid grid-cols-2 gap-1.5">
                    {(["sofa", "armchair", "table"] as const).map((k) => (
                      <Choice
                        key={k}
                        active={tpl === k}
                        title={k === "sofa" ? "Sofa" : k === "armchair" ? "Armchair" : "Table"}
                        hint={k === "sofa" ? "Couch, loveseat, settee" : k === "armchair" ? "Accent or lounge chair" : "Coffee, side, dining, desk"}
                        onClick={() => setTpl(k)}
                      />
                    ))}
                    <Choice active={tpl === null} title="Something else" hint="Built from the photo" onClick={() => setTpl(null)} />
                  </div>
                  {tpl === "sofa" ? (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[12px] text-chalk-3">Seats</span>
                      {([undefined, 2, 3, 4] as const).map((n) => (
                        <Pill key={String(n)} active={seats === n} onClick={() => setSeats(n)}>
                          {n ?? "Auto"}
                        </Pill>
                      ))}
                    </div>
                  ) : null}
                  {tpl === "sofa" || tpl === "armchair" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[12px] text-chalk-3">Arms</span>
                      <Pill active={arms === "square"} onClick={() => setArms("square")}>Square</Pill>
                      <Pill active={arms === "round"} onClick={() => setArms("round")}>Rounded</Pill>
                    </div>
                  ) : null}
                  {tpl === "table" ? (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[12px] text-chalk-3">Top</span>
                      <Pill active={tShape !== "round"} onClick={() => setTShape("rect")}>Rectangular</Pill>
                      <Pill active={tShape === "round"} onClick={() => setTShape("round")}>Round</Pill>
                      <span className="mx-1 text-[12px] text-chalk-3">Base</span>
                      <Pill active={tBase === "legs"} onClick={() => setTBase("legs")}>Four legs</Pill>
                      <Pill active={tBase === "pedestal"} onClick={() => setTBase("pedestal")}>Pedestal</Pill>
                    </div>
                  ) : null}
                  {tpl && photoColours ? (
                    <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-chalk-4">
                      Colours from your photo
                      {[photoColours.main, photoColours.dark, photoColours.light].map((c, i) => (
                        <span key={i} className="size-3.5 rounded-full border border-white/20" style={{ background: c }} />
                      ))}
                    </p>
                  ) : null}
                  <Button variant="primary" size="sm" className="mt-3 w-full" onClick={() => chooseModel(tpl)}>
                    {tpl ? "Use this model" : "Build it from the photo"}
                    <ArrowRight className="size-3.5" />
                  </Button>
                </Question>
              )
            ) : null}

            {/* 4 · Is this the item? (only when it's built from the photo) */}
            {photoPath && image && !busy && kindChosen && modelReady && editing !== "kind" && editing !== "method" ? (
              confirmed && editing !== "item" ? (
                <Answered
                  q="Item"
                  a={!removeBg ? "The whole picture, like a poster" : others > 0 && mainOnly ? "Just the main item" : "Just the item"}
                  onChange={() => setEditing("item")}
                />
              ) : (
                <Question n={offersExact ? 4 : 3} q="Is this your item?" sub="Check the preview — the background should be gone.">
                  {warning ? <Notice tone="warn">{warning}</Notice> : null}
                  <div className="mt-2 grid gap-1.5">
                    <Choice
                      active={confirmed && removeBg}
                      title="Yes, just the item"
                      hint={method === "exact" ? "Build its 3D model now" : "It's cut out and built in 3D"}
                      onClick={() => {
                        setRemoveBg(true);
                        setConfirmed(true);
                        setEditing(null);
                        if (method === "exact" && !mesh) void startGenerate();
                      }}
                    />
                    {removeBg && others > 0 ? (
                      <Choice
                        active={!mainOnly}
                        title={mainOnly ? `Keep the ${others} other ${others === 1 ? "thing" : "things"} too` : "Only the main item"}
                        hint={mainOnly ? "Everything that was in the photo" : "Leave out the rest of the photo"}
                        onClick={() => setMainOnly(!mainOnly)}
                      />
                    ) : null}
                    {kind === "wall" ? (
                      <Choice
                        active={confirmed && !removeBg}
                        title="Use the whole picture"
                        hint="Shown like a poster or print"
                        onClick={() => {
                          setRemoveBg(false);
                          setConfirmed(true);
                          setEditing(null);
                        }}
                      />
                    ) : null}
                  </div>
                </Question>
              )
            ) : null}

            {/* The exact model being built */}
            {method === "exact" && confirmed && editing === null && (generating || genError) ? (
              <section className="animate-fade rounded-[16px] border border-accent/30 bg-accent/5 p-3.5">
                {generating ? (
                  <>
                    <p className="flex items-center gap-2 text-[13px] font-semibold text-chalk">
                      <Spinner className="size-4" />
                      {generating}
                    </p>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-chalk-4">
                      Usually 20–40 seconds. You can keep this open while it works.
                    </p>
                  </>
                ) : genError ? (
                  <>
                    <Notice tone={genError.quota ? "warn" : "error"}>{genError.message}</Notice>
                    {genError.quota && genError.resetAt ? (
                      <ResetCountdown at={genError.resetAt} onReady={() => setGenError({ message: "Free 3D time is back — you can build it now.", quota: false })} />
                    ) : null}
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {!genError.quota ? <Pill onClick={() => void startGenerate()}>Try again</Pill> : null}
                      {offersMatched ? (
                        <Pill
                          onClick={() => {
                            setMethod("matched");
                            setModelChosen(false);
                            setGenError(null);
                          }}
                        >
                          Use a matched model
                        </Pill>
                      ) : null}
                      <Pill
                        onClick={() => {
                          setMethod("quick");
                          setGenError(null);
                        }}
                      >
                        Use quick 3D
                      </Pill>
                    </div>
                  </>
                ) : null}
              </section>
            ) : null}

            {/* 4 · How big? */}
            {kindChosen && methodReady && modelReady && meshReady && editing !== "kind" && editing !== "model" && editing !== "method" && (!photoPath || confirmed) ? (
              sized && editing !== "size" ? (
                <Answered
                  q="Size"
                  a={`${round(dims.w)} × ${round(dims.h)} × ${round(dims.d)} cm`}
                  onChange={() => setEditing("size")}
                />
              ) : (
                <Question
                  n={(offersExact ? 4 : 3) + (needsModel || photoPath ? 1 : 0)}
                  q="How big is it in real life?"
                  sub="A picture can't tell — this is what makes it true to size in your room."
                >
                  <div className="mb-2.5 flex flex-wrap gap-1.5">
                    {(tpl ? TPL_PRESETS[tpl === "mirror" && kind === "floor" ? "mirror-floor" : tpl] : PRESETS[kind]).map((p) => (
                      <Pill key={p.label} onClick={() => (tpl ? setDims(p.dims) : applyDims(p.dims))}>
                        {p.label}
                      </Pill>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(["w", "h", "d"] as const).map((k) => (
                      <label key={k} className="block">
                        <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.08em] text-chalk-4">
                          {k === "w" ? "Width" : k === "h" ? (isRug ? "Thickness" : "Height") : isRug ? "Length" : "Depth"}
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
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
                      {method === "exact" ? "Keep the model's proportions" : "Keep the photo's proportions"}
                    </label>
                  ) : null}
                  <Button
                    variant="primary"
                    size="sm"
                    className="mt-3 w-full"
                    disabled={![dims.w, dims.h, dims.d].every((v) => Number.isFinite(v) && v >= 0.2 && v <= 600)}
                    onClick={() => {
                      setSized(true);
                      setEditing(null);
                    }}
                  >
                    That&apos;s the size
                    <ArrowRight className="size-3.5" />
                  </Button>
                </Question>
              )
            ) : null}

            {/* 5 · Finishing touches */}
            {sized && editing === null ? (
              <Question n={(offersExact ? 5 : 4) + (needsModel || photoPath ? 1 : 0)} q="Last touches">
                <Field label="Name">
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Pink lightning neon" className={inputClass} />
                </Field>

                {(mount === "floor" || mount === "tabletop") && !isMirror && method !== "matched" ? (
                  <label className="mt-3 flex flex-wrap items-center gap-x-2 text-[12px] text-chalk-3">
                    <input
                      type="checkbox"
                      checked={isRug || holds}
                      disabled={isRug}
                      onChange={(e) => setHolds(e.target.checked)}
                      className="accent-[var(--color-accent)]"
                    />
                    Things can be placed on it
                    <span className="basis-full pl-6 text-[11px] text-chalk-4 sm:basis-auto sm:pl-0">
                      {isRug ? "· furniture and decor stand on a rug" : "· like a side table, stool or tray"}
                    </span>
                  </label>
                ) : null}

                {source === "shape" ? (
                  <div className="mt-3 space-y-3">
                    <Field label="Shape">
                      <div className="flex flex-wrap gap-1.5">
                        {SHAPES.map((sh) => (
                          <Pill key={sh.value} active={shape === sh.value} onClick={() => setShape(sh.value)}>
                            {sh.icon}
                            {sh.label}
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
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-[12px] text-chalk-3">Glows</span>
                  <Pill active={!glow} onClick={() => setGlow(null)}>
                    No
                  </Pill>
                  <Pill active={Boolean(glow)} onClick={() => setGlow(glow ?? "#ff4fa3")}>
                    Yes
                  </Pill>
                  {glow ? (
                    <input type="color" value={glow} onChange={(e) => setGlow(e.target.value)} aria-label="Glow colour" className="h-8 w-10 cursor-pointer rounded-[8px] border border-white/12 bg-transparent" />
                  ) : null}
                </div>

                {source !== "shape" && !isRug && method === "quick" ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setShowLook(!showLook)}
                      className="text-[12px] font-medium text-chalk-3 underline-offset-2 hover:text-chalk hover:underline"
                    >
                      Look: {styles.find((x) => x.value === style)?.label ?? "3D"} · change
                    </button>
                    {showLook ? (
                      <div className="mt-2 grid gap-1.5">
                        {styles.map((st) => (
                          <Choice key={st.value} active={style === st.value} title={st.label} hint={st.hint} onClick={() => setStyle(st.value)} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </Question>
            ) : null}
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
          <span className="flex-1 text-[11.5px] text-chalk-4">
            {!sized ? "Answer each question to save your item" : shaping ? "Shaping it in 3D…" : ""}
          </span>
          {sized ? (
            <>
              <Button variant="secondary" size="sm" disabled={!valid || Boolean(busy) || shaping} onClick={() => void save(false)}>
                Save to my items
              </Button>
              <Button variant="primary" size="sm" disabled={!valid || Boolean(busy) || shaping} onClick={() => void save(true)}>
                Save and place
              </Button>
            </>
          ) : null}
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

/** "5 h 12 min", "12 min", "under a minute". */
function untilText(at: number): string {
  const mins = Math.ceil((at - Date.now()) / 60000);
  if (mins <= 1) return "under a minute";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** A live countdown to when the free 3D time comes back. */
function ResetCountdown({ at, onReady }: { at: number; onReady: () => void }) {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() >= at) {
        clearInterval(id);
        onReady();
      } else tick((n) => n + 1);
    }, 15000);
    return () => clearInterval(id);
  }, [at, onReady]);
  return (
    <div className="mt-2.5 rounded-[12px] border border-white/8 p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-chalk-4">Free 3D resets in</p>
      <p className="mt-0.5 text-[18px] font-semibold tabular-nums text-chalk">{untilText(at)}</p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-chalk-3">
        Each device gets one free exact model a day. Meanwhile, a matched model or quick 3D works right away.
      </p>
    </div>
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

/** One question card. Appears with a short fade as the previous one is answered. */
function Question({ n, q, sub, children }: { n: number; q: string; sub?: string; children: React.ReactNode }) {
  // A new question scrolls into view — on a phone it would otherwise appear
  // below the fold, and the form would look finished when it isn't.
  const ref = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const t = setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
    return () => clearTimeout(t);
  }, []);
  return (
    <section ref={ref} className="animate-fade rounded-[16px] border border-white/9 bg-white/[0.025] p-3.5">
      <p className="flex items-center gap-2 text-[13.5px] font-semibold tracking-[-0.01em] text-chalk">
        <span className="grid size-5 place-items-center rounded-full bg-accent text-[11px] font-bold text-black">{n}</span>
        {q}
      </p>
      {sub ? <p className="mt-1 pl-7 text-[11.5px] leading-relaxed text-chalk-4">{sub}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** An answered question, folded to one line. */
function Answered({ q, a, onChange }: { q: string; a: string; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex w-full items-center gap-2 rounded-[12px] border border-white/7 px-3 py-2 text-left transition-colors hover:border-white/18"
    >
      <Check className="size-3.5 shrink-0 text-accent" />
      <span className="text-[11.5px] uppercase tracking-[0.07em] text-chalk-4">{q}</span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-chalk-2">{a}</span>
      <Pencil className="size-3 shrink-0 text-chalk-4" />
    </button>
  );
}

function Choice({ active, title, hint, onClick }: { active: boolean; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start rounded-[11px] border px-3 py-2 text-left transition-colors",
        active ? "border-accent/50 bg-accent/8" : "border-white/8 hover:border-white/18",
      )}
    >
      <span className={cn("text-[12.5px] font-semibold", active ? "text-accent" : "text-chalk")}>{title}</span>
      <span className="text-[11.5px] text-chalk-4">{hint}</span>
    </button>
  );
}
