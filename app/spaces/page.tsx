"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useProjects } from "@/lib/hooks/useProjects";
import { ProjectCard } from "@/components/shell/ProjectCard";
import { EmptyState, Skeleton, buttonClasses } from "@/components/ui/primitives";

export default function SpacesPage() {
  const { projects, loading, remove } = useProjects();

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-10 md:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display text-[38px] md:text-[46px]">My Spaces</h1>
          <p className="mt-2 text-[13.5px] text-chalk-3">
            {loading
              ? "Loading your rooms…"
              : projects && projects.length > 0
                ? `${projects.length} ${projects.length === 1 ? "room" : "rooms"} saved on this device`
                : "Nothing saved yet"}
          </p>
        </div>

        <Link href="/onboarding" className={buttonClasses("primary", "md", "gap-2")}>
          <Plus className="size-4" strokeWidth={2.4} />
          New space
        </Link>
      </header>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-[4/3]" />
          ))}
        </div>
      ) : !projects || projects.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-white/8 bg-ink-1/50">
          <EmptyState
            icon={<Plus className="size-5" />}
            title="No spaces yet"
            body="Upload one photo of your room and AURA will rebuild it in 3D for you to design in."
            action={
              <Link href="/onboarding" className={buttonClasses("primary", "md")}>
                Upload your room
              </Link>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onDelete={remove} />
          ))}

          <Link
            href="/onboarding"
            className="group flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-white/12 transition-all duration-300 hover:border-accent/40 hover:bg-ink-1"
          >
            <div className="grid size-11 place-items-center rounded-[13px] bg-white/6 text-chalk-2 transition-all duration-300 group-hover:bg-accent group-hover:text-black">
              <Plus className="size-5" strokeWidth={2.2} />
            </div>
            <p className="text-[13.5px] font-medium text-chalk-2">Add another space</p>
          </Link>
        </div>
      )}

      <p className="mt-10 text-[12px] leading-relaxed text-chalk-4">
        Spaces live in this browser&apos;s storage — nothing is uploaded anywhere.
        Clearing site data will remove them.
      </p>
    </div>
  );
}
