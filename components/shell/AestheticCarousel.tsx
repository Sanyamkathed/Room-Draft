"use client";

import Link from "next/link";
import { ArrowRight, BookmarkCheck } from "lucide-react";
import { AESTHETICS, type AestheticId } from "@/lib/catalog/types";
import CoverflowCarousel from "@/components/ui/coverflow-carousel";
import { MoodTile } from "./MoodTile";

/** Every aesthetic as a coverflow card; the centre card opens its theme page. */
export function AestheticCarousel({
  saved = [],
  autoplay = false,
  showJumpList = false,
}: {
  saved?: AestheticId[];
  autoplay?: boolean;
  showJumpList?: boolean;
}) {
  const items = AESTHETICS.map((a, i) => ({
    id: a.id,
    label: a.label,
    content: (
      <Link
        href={`/discover?theme=${a.id}`}
        draggable={false}
        className="group block h-full w-full"
      >
        <MoodTile aesthetic={a.id} seed={i} className="h-full w-full rounded-none">
          <div className="absolute inset-x-[18px] bottom-[18px] z-10">
            <h3 className="text-[18px] font-semibold tracking-[-0.02em] text-[#fffaf1]">
              {a.label}
            </h3>
            <p className="mt-[5px] text-[12px] leading-snug text-[rgba(255,250,241,0.74)]">
              {a.blurb}
            </p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-accent">
              Explore this style
              <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
            </span>
          </div>
          {saved.includes(a.id) && (
            <span className="absolute right-3 top-3 z-10 grid size-6 place-items-center rounded-full bg-accent text-accent-ink">
              <BookmarkCheck className="size-3.5" strokeWidth={2.6} />
            </span>
          )}
        </MoodTile>
      </Link>
    ),
  }));

  return (
    <CoverflowCarousel
      items={items}
      loop
      autoplay={autoplay}
      autoplayDelay={4500}
      showJumpList={showJumpList}
      spacing={230}
      rotation={42}
      stageClassName="h-[360px] md:h-[420px]"
      cardClassName="h-[320px] w-[230px] md:h-[380px] md:w-[290px]"
    />
  );
}
