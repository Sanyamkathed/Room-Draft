"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Box } from "lucide-react";
import { buildSampleProject } from "@/lib/sample/room";
import { storage } from "@/lib/storage/idb";
import { buttonClasses } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";

/**
 * Opens a furnished sample room in the studio, so someone can try every tool
 * before they have a photo of their own. Each click makes a fresh copy: the
 * sample is theirs to wreck.
 */
export function TrySampleRoom({
  className,
  variant = "outline",
  size = "lg",
  label = "Try a sample room",
}: {
  className?: string;
  variant?: "outline" | "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const open = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const project = buildSampleProject();
      await storage.saveProject(project);
      router.push(`/studio/${project.id}`);
    } catch {
      setBusy(false);
      setFailed(true);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      aria-busy={busy}
      className={cn(buttonClasses(variant, size), "disabled:opacity-60", className)}
      title={failed ? "Couldn't open the sample room. Check that this browser allows site storage, then try again." : undefined}
    >
      <Box className="size-[17px]" strokeWidth={2} />
      {busy ? "Opening the room…" : failed ? "Try again" : label}
    </button>
  );
}
