"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Layers, Sparkles, X, Zap } from "lucide-react";
import { Button, Spinner, buttonClasses } from "@/components/ui/primitives";
import { Calibrator } from "@/components/onboarding/Calibrator";
import { DimensionsStep, SurfaceGrid } from "@/components/onboarding/FullRoomCapture";
import { Processing } from "@/components/onboarding/Processing";
import { SurfaceRectifier } from "@/components/onboarding/SurfaceRectifier";
import { Uploader, type UploadedShot } from "@/components/onboarding/Uploader";
import { itemsFromAnalysis, summarise } from "@/lib/cv/adapt";
import { advisories, analyzeRoom, cvAvailable, type CvAnalysis } from "@/lib/cv/client";
import { defaultSurfaceQuad } from "@/lib/room/homography";
import { analysePerspective, defaultBackWall } from "@/lib/room/perspective";
import {
  DEFAULT_ROOM_DIMENSIONS,
  planCoverage,
} from "@/lib/room/plan";
import { DEFAULT_CAMERA_HEIGHT, defaultCalibration } from "@/lib/room/reconstruct";
import { SURFACE_LABELS, surfaceExtent } from "@/lib/room/surfaces";
import type { Quad, RoomGeometry, RoomPlan, SurfaceId } from "@/lib/room/types";
import type { PlacedItem } from "@/lib/placement/types";
import { newImageId, newProjectId, storage } from "@/lib/storage/idb";
import { PROJECT_VERSION, type Project, type ProjectImage } from "@/lib/storage/types";
import { usePreferences } from "@/lib/hooks/useProjects";
import { loadImage, prepareImage } from "@/lib/utils/image";
import { cn } from "@/lib/utils/cn";

type Step =
  | "welcome"
  // quick path
  | "upload"
  | "processing"
  | "calibrate"
  // full path
  | "dimensions"
  | "surfaces";

const FALLBACK_PALETTE: RoomGeometry["palette"] = {
  wall: "#b9b4ac",
  floor: "#6b5c4c",
  ceiling: "#cfcbc4",
  accent: "#7a8fa6",
};

export default function OnboardingPage() {
  const router = useRouter();
  const { prefs, update } = usePreferences();

  const [step, setStep] = React.useState<Step>("welcome");
  const [name, setName] = React.useState("My Space");
  const [creating, setCreating] = React.useState(false);
  const [palette, setPalette] = React.useState<RoomGeometry["palette"] | null>(null);

  /* ---------------- quick path state ---------------- */
  const [shots, setShots] = React.useState<UploadedShot[]>([]);
  const [primaryId, setPrimaryId] = React.useState<string | null>(null);
  const [calibration, setCalibration] = React.useState<
    ReturnType<typeof defaultCalibration> | null
  >(null);
  const primary = shots.find((s) => s.id === primaryId) ?? shots[0] ?? null;

  /**
   * What the analysis service found, if it was reachable and useful.
   *
   * `analysed` is a separate flag rather than `analysis !== null` because the
   * two mean different things: the service being unavailable is a completed
   * analysis with no result, and the processing screen has to move on from
   * it exactly as it would from a successful one.
   */
  const [analysis, setAnalysis] = React.useState<CvAnalysis | null>(null);
  const [analysed, setAnalysed] = React.useState(false);
  const [cvNote, setCvNote] = React.useState<string | undefined>();
  const [seeded, setSeeded] = React.useState<PlacedItem[]>([]);

  /* ---------------- full path state ---------------- */
  const [images, setImages] = React.useState<ProjectImage[]>([]);
  const [plan, setPlan] = React.useState<RoomPlan>({
    dimensions: DEFAULT_ROOM_DIMENSIONS,
    surfaces: {},
  });
  const [marking, setMarking] = React.useState<{
    surface: SurfaceId;
    image: ProjectImage;
    quad: Quad;
  } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const pendingSurface = React.useRef<SurfaceId | null>(null);

  const coverage = planCoverage(plan);

  /* ---------------- quick: solve the room ---------------- */
  /**
   * Three tiers, best first, and every one of them ends with a usable room.
   *
   *   1. the analysis service — depth, detection, real measurements
   *   2. the local perspective solve — no network, no model, ~40ms
   *   3. a centred one-point fit — always works, user drags from it
   *
   * The local solve runs *first and unconditionally*, not as a catch block.
   * It is fast enough to be free, and doing it up front means the screen
   * already holds a working answer while the service is still thinking — so
   * a slow or absent backend costs the user nothing but the wait they chose.
   */
  React.useEffect(() => {
    if (step !== "processing" || !primary) return;
    let cancelled = false;
    const control = new AbortController();

    setAnalysed(false);
    setAnalysis(null);
    setSeeded([]);
    setCvNote(undefined);

    void (async () => {
      // --- tier 2/3: always have something ---
      try {
        const img = await loadImage(primary.dataUrl);
        if (cancelled) return;
        const estimate = analysePerspective(img);
        setPalette(estimate.palette);
        setCalibration(
          defaultCalibration(
            estimate.vanishingPoint,
            defaultBackWall(estimate.vanishingPoint),
          ),
        );
      } catch {
        if (cancelled) return;
        setPalette(FALLBACK_PALETTE);
        setCalibration(defaultCalibration([0.5, 0.5], defaultBackWall([0.5, 0.5])));
      }

      // --- tier 1: the service, if it is there ---
      if (!(await cvAvailable(control.signal))) {
        if (!cancelled) setAnalysed(true);
        return;
      }
      if (cancelled) return;
      setCvNote("Measuring depth and looking for furniture…");

      // The shot is held as a data URL; the service wants bytes.
      const blob = await fetch(primary.dataUrl).then((r) => r.blob());
      if (cancelled) return;

      const result = await analyzeRoom(blob, {
        cameraHeight: DEFAULT_CAMERA_HEIGHT,
        signal: control.signal,
      });
      if (cancelled) return;

      if (result.ok) {
        const { analysis: found } = result;
        setAnalysis(found);
        setCalibration(found.calibration);
        setPalette(found.palette);
        setSeeded(itemsFromAnalysis(found));
        setCvNote(summarise(found));
      } else if (result.reason === "warming" || result.reason === "timeout") {
        setCvNote("The analysis service is still warming up — using a quick estimate.");
      } else if (result.reason !== "aborted") {
        setCvNote(undefined);
      }
      setAnalysed(true);
    })();

    return () => {
      cancelled = true;
      control.abort();
    };
  }, [step, primary]);

  /* ---------------- full: photo intake ---------------- */
  const onFilePicked = React.useCallback(
    async (file: File) => {
      const surface = pendingSurface.current;
      if (!surface) return;
      setBusy(true);
      try {
        const prepared = await prepareImage(file);
        const image: ProjectImage = {
          id: newImageId(),
          dataUrl: prepared.dataUrl,
          width: prepared.width,
          height: prepared.height,
          label: SURFACE_LABELS[surface],
        };
        setImages((prev) => [...prev, image]);

        // The first photo in also supplies the room's fallback palette, so
        // surfaces nobody photographs are painted a colour from this room.
        if (!palette) {
          try {
            const el = await loadImage(prepared.dataUrl);
            setPalette(analysePerspective(el).palette);
          } catch {
            setPalette(FALLBACK_PALETTE);
          }
        }

        setMarking({ surface, image, quad: defaultSurfaceQuad() });
      } finally {
        setBusy(false);
        pendingSurface.current = null;
      }
    },
    [palette],
  );

  const pickSurface = React.useCallback(
    (surface: SurfaceId) => {
      const existing = plan.surfaces[surface];
      if (existing) {
        const image = images.find((i) => i.id === existing.imageId);
        if (image) {
          setMarking({ surface, image, quad: existing.quad });
          return;
        }
      }
      pendingSurface.current = surface;
      fileInput.current?.click();
    },
    [plan.surfaces, images],
  );

  const confirmMarking = React.useCallback(() => {
    if (!marking) return;
    setPlan((p) => ({
      ...p,
      surfaces: {
        ...p.surfaces,
        [marking.surface]: { imageId: marking.image.id, quad: marking.quad },
      },
    }));
    setMarking(null);
  }, [marking]);

  const removeSurface = React.useCallback((surface: SurfaceId) => {
    setPlan((p) => {
      const surfaces = { ...p.surfaces };
      delete surfaces[surface];
      return { ...p, surfaces };
    });
  }, []);

  /* ---------------- create ---------------- */
  const createProject = React.useCallback(
    async (mode: "quick" | "full") => {
      setCreating(true);

      const base = {
        id: newProjectId(),
        version: PROJECT_VERSION,
        name: name.trim() || "My Space",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        palette: palette ?? FALLBACK_PALETTE,
        // Furniture the service recognised in the photo. Seeding it here
        // rather than in the studio means undo has nothing odd to unwind and
        // the room is already correct the first time it renders.
        items: mode === "quick" ? seeded : [],
        aesthetic: null,
      };

      let project: Project;

      if (mode === "quick") {
        if (!primary || !calibration) {
          setCreating(false);
          return;
        }
        project = {
          ...base,
          mode: "quick",
          images: [
            {
              id: "src",
              dataUrl: primary.dataUrl,
              width: primary.width,
              height: primary.height,
              label: "Room photo",
            },
          ],
          calibration,
          thumbnail: primary.dataUrl,
        };
      } else {
        project = {
          ...base,
          mode: "full",
          images,
          plan,
          thumbnail: images[0]?.dataUrl,
        };
      }

      try {
        await storage.saveProject(project);
        router.push(`/studio/${project.id}`);
      } catch {
        setCreating(false);
      }
    },
    [name, palette, primary, calibration, images, plan, seeded, router],
  );

  /* ---------------- chrome ---------------- */
  const quickSteps: Step[] = ["upload", "processing", "calibrate"];
  const fullSteps: Step[] = ["dimensions", "surfaces"];
  const track = quickSteps.includes(step) ? quickSteps : fullSteps;
  const trackIndex = track.indexOf(step);

  const back = () => {
    if (step === "welcome") return;
    if (trackIndex <= 0) setStep("welcome");
    else setStep(track[trackIndex - 1]);
  };

  return (
    <div className="min-h-dvh bg-ink-0">
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void onFilePicked(file);
        }}
      />

      <header className="sticky top-0 z-40 border-b border-white/7 glass-strong">
        <div className="mx-auto flex h-[60px] max-w-[1180px] items-center gap-4 px-5 md:px-8">
          {step === "welcome" ? (
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-[13px] font-medium text-chalk-2 transition-colors hover:text-chalk"
            >
              <ArrowLeft className="size-4" />
              Home
            </Link>
          ) : (
            <button
              onClick={back}
              className="inline-flex items-center gap-2 text-[13px] font-medium text-chalk-2 transition-colors hover:text-chalk"
            >
              <ArrowLeft className="size-4" />
              Back
            </button>
          )}

          {step !== "welcome" && (
            <div className="mx-auto flex items-center gap-1.5">
              {track.map((s, i) => (
                <span
                  key={s}
                  className={cn(
                    "h-1 rounded-full transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
                    i < trackIndex && "w-6 bg-accent/50",
                    i === trackIndex && "w-10 bg-accent",
                    i > trackIndex && "w-6 bg-white/12",
                  )}
                />
              ))}
            </div>
          )}

          <span className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] font-semibold tracking-[-0.01em]">
            <Sparkles className="size-3.5 text-accent" />
            AURA
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 py-10 md:px-8 md:py-14">
        {/* ---------------- Welcome ---------------- */}
        {step === "welcome" && (
          <div className="animate-rise">
            <p className="text-[11px] uppercase tracking-[0.12em] text-accent font-semibold">
              Get started
            </p>
            <h1 className="text-display mt-4 text-[44px] leading-[0.95] md:text-[62px]">
              Design your space
              <br />
              <span className="text-chalk-3">before you buy it.</span>
            </h1>
            <p className="mt-6 max-w-[52ch] text-[15px] leading-relaxed text-chalk-2">
              Two ways in. Photograph every surface and get your whole room —
              walls, floor and ceiling — rebuilt in 3D. Or point at one wall and
              see it working in under a minute.
            </p>

            <div className="mt-9 grid gap-4 md:grid-cols-2">
              <button
                onClick={() => setStep("dimensions")}
                className="group relative overflow-hidden rounded-[22px] border border-accent/30 bg-ink-1 p-6 text-left transition-all duration-300 hover:border-accent/60"
              >
                <div
                  className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full blur-[60px] opacity-40"
                  style={{ background: "rgba(216,255,60,0.35)" }}
                />
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <span className="grid size-9 place-items-center rounded-[11px] bg-accent text-black">
                      <Layers className="size-4.5" strokeWidth={2.2} />
                    </span>
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-black">
                      RECOMMENDED
                    </span>
                  </div>
                  <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.025em]">
                    Full room
                  </h2>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-chalk-2">
                    Six photos — four walls, the floor, the ceiling. Every surface
                    gets its own texture from the shot that actually saw it.
                  </p>
                  <ul className="mt-4 space-y-1.5">
                    {[
                      "All four walls textured, not just one",
                      "Real measured dimensions",
                      "Add your bed, desk and wardrobe",
                    ].map((t) => (
                      <li key={t} className="flex items-center gap-2 text-[12.5px] text-chalk-3">
                        <Check className="size-3.5 shrink-0 text-accent" strokeWidth={2.6} />
                        {t}
                      </li>
                    ))}
                  </ul>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent">
                    Start capturing
                    <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                  </span>
                </div>
              </button>

              <button
                onClick={() => setStep("upload")}
                className="group rounded-[22px] border border-white/10 bg-ink-1/60 p-6 text-left transition-all duration-300 hover:border-white/25"
              >
                <span className="grid size-9 place-items-center rounded-[11px] bg-white/8 text-chalk-2">
                  <Zap className="size-4.5" strokeWidth={2.2} />
                </span>
                <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.025em]">
                  Quick look
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-chalk-2">
                  One photo. We solve its perspective and build a room around it —
                  the wall you shot looks right, the rest is clean paint.
                </p>
                <p className="mt-4 text-[12px] leading-relaxed text-chalk-4">
                  Good for trying it out. You can add the other surfaces later
                  without starting over.
                </p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-chalk-2">
                  One photo
                  <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                </span>
              </button>
            </div>
          </div>
        )}

        {/* ---------------- Full: dimensions ---------------- */}
        {step === "dimensions" && (
          <div className="animate-rise">
            <p className="text-[11px] uppercase tracking-[0.12em] text-accent font-semibold">
              Step one of two
            </p>
            <h1 className="text-display mt-3 text-[36px] md:text-[46px]">
              How big is your room?
            </h1>
            <p className="mt-3 max-w-[54ch] text-[14px] leading-relaxed text-chalk-2">
              Six separate photos have no shared camera to solve scale from, so
              this is the measurement everything else is built on.
            </p>

            <div className="mt-8">
              <DimensionsStep
                dimensions={plan.dimensions}
                units={prefs.units}
                onChange={(dimensions) => setPlan((p) => ({ ...p, dimensions }))}
                onUnits={(units) => void update({ units })}
              />
            </div>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <label className="block">
                <span className="text-[11px] uppercase tracking-[0.09em] text-chalk-3 font-medium">
                  Name this space
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Anime Room"
                  className="mt-1.5 h-10 w-full rounded-[11px] border border-white/10 bg-ink-2 px-3.5 text-[14px] text-chalk outline-none transition-colors placeholder:text-chalk-4 focus:border-accent/50 sm:w-[280px]"
                />
              </label>

              <Button
                size="lg"
                variant="primary"
                className="group"
                onClick={() => setStep("surfaces")}
              >
                Photograph the room
                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </Button>
            </div>
          </div>
        )}

        {/* ---------------- Full: surfaces ---------------- */}
        {step === "surfaces" && (
          <div className="animate-rise">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-accent font-semibold">
                  Step two of two
                </p>
                <h1 className="text-display mt-3 text-[36px] md:text-[46px]">
                  Shoot each surface
                </h1>
                <p className="mt-3 max-w-[54ch] text-[14px] leading-relaxed text-chalk-2">
                  Stand facing each one and shoot it as square-on as you can. Skip
                  any you don&apos;t care about — they render as clean paint.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-[0.09em] text-chalk-4">
                    Captured
                  </p>
                  <p className="text-[19px] font-semibold tabular-nums">
                    {coverage.captured.length}
                    <span className="text-[13px] text-chalk-4"> / 6</span>
                  </p>
                </div>
                <Button
                  size="lg"
                  variant="primary"
                  loading={creating}
                  disabled={coverage.captured.length === 0}
                  onClick={() => void createProject("full")}
                  className="group"
                >
                  {creating ? "Opening studio" : "Enter design studio"}
                  {!creating && (
                    <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                  )}
                </Button>
              </div>
            </div>

            <SurfaceGrid
              plan={plan}
              images={images}
              onPick={pickSurface}
              onRemove={removeSurface}
            />

            {coverage.captured.length === 0 && (
              <p className="mt-6 text-[13px] text-chalk-3">
                Start with the back wall — it&apos;s the one you look at most.
              </p>
            )}

            {busy && (
              <div className="mt-6 flex items-center gap-3 text-chalk-3">
                <Spinner />
                <span className="text-[13px]">Preparing that photo…</span>
              </div>
            )}
          </div>
        )}

        {/* ---------------- Quick: upload ---------------- */}
        {step === "upload" && (
          <div className="animate-rise mx-auto max-w-[760px]">
            <p className="text-[11px] uppercase tracking-[0.12em] text-accent font-semibold">
              Quick look
            </p>
            <h1 className="text-display mt-3 text-[36px] md:text-[46px]">
              Upload your space
            </h1>
            <p className="mt-4 max-w-[54ch] text-[14.5px] leading-relaxed text-chalk-2">
              One photo is enough. Stand in a corner and get the floor and one
              full wall in frame.
            </p>

            <div className="mt-8">
              <Uploader
                shots={shots}
                onChange={setShots}
                primaryId={primaryId}
                onPrimary={setPrimaryId}
              />
            </div>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <label className="block">
                <span className="text-[11px] uppercase tracking-[0.09em] text-chalk-3 font-medium">
                  Name this space
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Anime Room"
                  className="mt-1.5 h-10 w-full rounded-[11px] border border-white/10 bg-ink-2 px-3.5 text-[14px] text-chalk outline-none transition-colors placeholder:text-chalk-4 focus:border-accent/50 sm:w-[280px]"
                />
              </label>

              <Button
                size="lg"
                variant="primary"
                disabled={!primary}
                onClick={() => setStep("processing")}
                className="group"
              >
                Build my 3D room
                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </Button>
            </div>
          </div>
        )}

        {/* ---------------- Quick: processing ---------------- */}
        {step === "processing" && primary && (
          <div className="animate-rise">
            <Processing
              imageUrl={primary.dataUrl}
              ready={analysed}
              note={cvNote}
              onDone={() => setStep("calibrate")}
            />
          </div>
        )}

        {/* ---------------- Quick: calibrate ---------------- */}
        {step === "calibrate" && primary && calibration && palette && (
          <div className="animate-rise">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-accent font-semibold">
                  Last step
                </p>
                <h1 className="text-display mt-3 text-[34px] md:text-[42px]">
                  Check the fit
                </h1>
                <p className="mt-3 max-w-[52ch] text-[14px] leading-relaxed text-chalk-2">
                  {analysis
                    ? "We measured the wall facing you. Nudge any corner that looks off — the closer this is, the better everything you place will sit."
                    : "We found the wall facing you. Drag the four corners onto its real edges — the closer this is, the better everything you place will sit."}
                </p>

                {/*
                  What was measured versus what was assumed. A room built on a
                  guessed ceiling height and one built on two fitted planes are
                  both just numbers on screen, and the user is the only one who
                  can tell us which guesses were wrong.
                */}
                {analysis && (
                  <div className="mt-4 max-w-[52ch] space-y-2">
                    <p className="text-[12.5px] text-chalk-3">
                      <span className="text-accent">●</span> {summarise(analysis)}
                      {seeded.length > 0 && " — already placed in your room"}
                    </p>
                    {advisories(analysis).slice(0, 3).map((note) => (
                      <p key={note} className="text-[12.5px] leading-relaxed text-chalk-4">
                        {note}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <Button
                size="lg"
                variant="primary"
                loading={creating}
                onClick={() => void createProject("quick")}
                className="group"
              >
                {creating ? "Opening studio" : "Enter design studio"}
                {!creating && (
                  <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                )}
              </Button>
            </div>

            <Calibrator
              imageUrl={primary.dataUrl}
              imageWidth={primary.width}
              imageHeight={primary.height}
              palette={palette}
              calibration={calibration}
              onChange={setCalibration}
            />
          </div>
        )}

        {step === "calibrate" && (!calibration || !palette) && (
          <div className="flex items-center justify-center gap-3 py-24 text-chalk-3">
            <Spinner />
            <span className="text-[13.5px]">Finishing the reconstruction…</span>
          </div>
        )}
      </main>

      {/* ---------------- Corner-marking overlay ---------------- */}
      {marking && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-ink-0/97 backdrop-blur-xl">
          <header className="flex h-[60px] shrink-0 items-center justify-between gap-4 border-b border-white/8 px-5">
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.02em]">
                Mark the {SURFACE_LABELS[marking.surface].toLowerCase()}
              </h2>
              <p className="text-[11.5px] text-chalk-4">
                Drag the four numbered handles onto its corners
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" size="sm" onClick={confirmMarking}>
                <Check className="size-3.5" strokeWidth={2.6} />
                Done
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Cancel"
                onClick={() => setMarking(null)}
              >
                <X className="size-4" />
              </Button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-8">
            <div className="mx-auto max-w-[1100px]">
              <SurfaceRectifier
                surface={marking.surface}
                imageUrl={marking.image.dataUrl}
                quad={marking.quad}
                onChange={(quad) => setMarking((m) => (m ? { ...m, quad } : m))}
                extent={surfaceExtent(marking.surface, plan.dimensions)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Keeps the quick path's "add more later" promise honest */}
      {step === "welcome" && (
        <p className="mx-auto max-w-[1180px] px-5 pb-10 text-[12px] text-chalk-4 md:px-8">
          Either way your room stays on this device.{" "}
          <Link href="/spaces" className={buttonClasses("ghost", "sm", "h-auto px-0 underline")}>
            Open an existing space
          </Link>
        </p>
      )}
    </div>
  );
}
