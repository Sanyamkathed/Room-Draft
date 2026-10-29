"use client";

import Link from "next/link";
import { ArrowRight, BookmarkCheck } from "lucide-react";
import { AESTHETICS, type AestheticId } from "@/lib/catalog/types";
import { aestheticPhoto } from "@/lib/catalog/aestheticPhotos";
import CoverflowCarousel from "@/components/ui/coverflow-carousel";

/** Every aesthetic as a coverflow card of a real room; the centre card opens its theme page. */
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
        className="group relative block h-full w-full overflow-hidden bg-ink-3"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={aestheticPhoto(a.id)}
          srcSet={`${aestheticPhoto(a.id, 480, 600)} 480w, ${aestheticPhoto(a.id)} 640w`}
          sizes="(max-width: 767px) 240px, 300px"
          alt={`A ${a.label.toLowerCase()} room`}
          draggable={false}
          decoding="async"
          loading={i < 4 ? "eager" : "lazy"}
          className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(28,24,20,0.94)_0%,rgba(28,24,20,0.55)_38%,transparent_70%)]" />
        <div className="absolute inset-x-[18px] bottom-[18px]">
          <h3 className="font-[family-name:var(--font-display)] text-[24px] font-bold leading-none tracking-[-0.03em] text-chalk">
            {a.label}
          </h3>
          <p className="mt-2 text-[12.5px] leading-snug text-chalk-2">{a.blurb}</p>
          <span className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent">
            Explore this style
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
          </span>
        </div>
        {saved.includes(a.id) && (
          <span className="absolute right-3 top-3 grid size-7 place-items-center rounded-full bg-accent text-accent-ink">
            <BookmarkCheck className="size-3.5" strokeWidth={2.6} />
          </span>
        )}
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
      stageClassName="h-[380px] md:h-[440px]"
      cardClassName="h-[340px] w-[240px] md:h-[400px] md:w-[300px]"
    />
  );
}
