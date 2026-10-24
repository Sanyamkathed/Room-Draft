"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Sparkles } from "lucide-react";
import { StudioShell } from "@/components/studio/StudioShell";
import { useStudio } from "@/lib/store/studio";
import { loadCustomLibrary, registerCustom } from "@/lib/catalog/custom";
import { storage } from "@/lib/storage/idb";
import { loadImage } from "@/lib/utils/image";
import { Spinner, buttonClasses } from "@/components/ui/primitives";

type LoadState = "loading" | "ready" | "missing" | "error";

export default function StudioPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const load = useStudio((s) => s.load);
  const reset = useStudio((s) => s.reset);
  const loadedId = useStudio((s) => s.project?.id);
  const [state, setState] = React.useState<LoadState>("loading");

  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;

    void (async () => {
      try {
        const [project] = await Promise.all([storage.getProject(id), loadCustomLibrary()]);
        if (cancelled) return;
        if (!project) {
          setState("missing");
          return;
        }
        // Items the user made render from the room's own copy if this
        // browser's library doesn't have them (another device, cleared data).
        registerCustom(project.customProducts);

        // Photos are stored as data URLs; the 3D layer needs decoded elements
        // before the room material can sample them. Full-room projects carry
        // up to six, so they decode in parallel.
        const decoded = await Promise.all(
          project.images.map(async (img) => [img.id, await loadImage(img.dataUrl)] as const),
        );
        if (cancelled) return;

        load(project, Object.fromEntries(decoded));
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, load]);

  // Drop the project when leaving the studio, so a stale room never flashes
  // behind the next one that opens.
  React.useEffect(() => () => reset(), [reset]);

  if (state === "loading" || (state === "ready" && loadedId !== id)) {
    return (
      <div className="grid h-dvh place-items-center bg-ink-0">
        <div className="flex flex-col items-center gap-4">
          <Spinner className="size-6" />
          <p className="text-[13.5px] text-chalk-3">Rebuilding your room…</p>
        </div>
      </div>
    );
  }

  if (state === "missing" || state === "error") {
    return (
      <div className="grid h-dvh place-items-center bg-ink-0 px-6">
        <div className="max-w-[40ch] text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-[14px] bg-white/6 text-chalk-2">
            <Sparkles className="size-5" />
          </div>
          <h1 className="mt-5 text-[20px] font-semibold tracking-[-0.025em]">
            {state === "missing" ? "That space isn't here" : "Couldn't open that space"}
          </h1>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-chalk-3">
            {state === "missing"
              ? "Spaces are stored on this device. If you saved it in another browser or cleared your site data, it won't be here."
              : "Something went wrong reading it back. Your other spaces are unaffected."}
          </p>
          <div className="mt-7 flex justify-center gap-2.5">
            <Link href="/spaces" className={buttonClasses("secondary", "md")}>
              My spaces
            </Link>
            <Link href="/onboarding" className={buttonClasses("primary", "md")}>
              Create a new space
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <StudioShell />;
}
