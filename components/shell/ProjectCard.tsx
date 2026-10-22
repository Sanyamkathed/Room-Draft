"use client";

import Link from "next/link";
import { useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import type { ProjectSummary } from "@/lib/storage/types";
import { cn } from "@/lib/utils/cn";
import { MoodTile } from "./MoodTile";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function ProjectCard({
  project,
  onDelete,
  className,
}: {
  project: ProjectSummary;
  onDelete?: (id: string) => void | Promise<void>;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className={cn("group relative", className)}>
      <Link href={`/studio/${project.id}`} className="block">
        <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-card)] border border-white/8 bg-ink-2 transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:border-white/18">
          {project.thumbnail ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={project.thumbnail}
              alt=""
              className="size-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
            />
          ) : (
            <MoodTile
              aesthetic={project.aesthetic ?? "minimalist"}
              seed={project.name.length}
              className="size-full rounded-none"
            />
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute bottom-3 left-3.5 right-3.5">
            <p className="truncate text-[13.5px] font-semibold tracking-[-0.015em] text-white">
              {project.name}
            </p>
            <p className="mt-0.5 text-[11.5px] text-white/60">
              {project.itemCount} {project.itemCount === 1 ? "item" : "items"} ·{" "}
              {relativeTime(project.updatedAt)}
            </p>
          </div>
        </div>
      </Link>

      {onDelete && (
        <div className="absolute right-2.5 top-2.5">
          {confirming ? (
            <div className="flex items-center gap-1 rounded-[10px] glass-strong p-1 edge-light">
              <button
                onClick={() => void onDelete(project.id)}
                className="rounded-[7px] px-2 py-1 text-[11.5px] font-semibold text-danger transition-colors hover:bg-danger/15"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded-[7px] px-2 py-1 text-[11.5px] font-medium text-chalk-2 transition-colors hover:bg-white/8"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              aria-label={`Delete ${project.name}`}
              className="grid size-8 place-items-center rounded-[9px] glass-strong text-chalk-2 opacity-0 transition-all duration-250 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function DeleteHint() {
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] text-chalk-4">
      <Trash2 className="size-3" /> Hover a card to manage it
    </span>
  );
}
