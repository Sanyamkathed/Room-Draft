"use client";

import * as React from "react";
import { ArrowUp, Check, Sparkles, X } from "lucide-react";
import { STARTER_PROMPTS, buildSuggestion, type Suggestion } from "@/lib/assistant/engine";
import { formatINR } from "@/lib/catalog/source";
import { aestheticById } from "@/lib/catalog/types";
import { usePreferences } from "@/lib/hooks/useProjects";
import { useStudio } from "@/lib/store/studio";
import { Badge, Button, Chip, IconButton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";
import { ProductThumb } from "./ProductThumb";

/**
 * The design assistant.
 *
 * Every suggestion is resolved through the real placement pipeline before it
 * is shown, so "Apply" is guaranteed to produce a valid room — nothing floats,
 * clips or overhangs. When a request can't be matched the panel says so
 * plainly instead of inventing a generic answer.
 */
export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const room = useStudio((s) => s.room);
  const items = useStudio((s) => s.items);
  const project = useStudio((s) => s.project);
  const addItemAt = useStudio((s) => s.addItemAt);
  const { prefs } = usePreferences();

  const [query, setQuery] = React.useState("");
  const [suggestion, setSuggestion] = React.useState<Suggestion | null>(null);
  const [missed, setMissed] = React.useState<string | null>(null);
  const [applied, setApplied] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = React.useCallback(
    (text: string) => {
      if (!room || !text.trim()) return;
      setApplied(false);

      const result = buildSuggestion(text, room, items, {
        saved: prefs.savedProductIds,
        fallbackAesthetic: project?.aesthetic ?? null,
      });

      if (!result) {
        setSuggestion(null);
        setMissed(text);
        return;
      }
      setMissed(null);
      setSuggestion(result);
    },
    [room, items, prefs.savedProductIds, project?.aesthetic],
  );

  const apply = React.useCallback(() => {
    if (!suggestion) return;
    for (const p of suggestion.placements) addItemAt(p.product.id, p.item);
    setApplied(true);
  }, [suggestion, addItemAt]);

  return (
    <aside className="pointer-events-auto absolute right-0 top-0 z-40 flex h-full w-full flex-col border-l border-white/8 bg-ink-1/95 backdrop-blur-2xl sm:w-[368px]">
      <header className="flex items-center justify-between gap-2 border-b border-white/7 px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-[9px] bg-accent text-black">
            <Sparkles className="size-3.5" strokeWidth={2.4} />
          </span>
          <div>
            <h2 className="text-[13.5px] font-semibold tracking-[-0.02em]">
              Design assistant
            </h2>
            <p className="text-[11px] text-chalk-4">Sized and placed for your room</p>
          </div>
        </div>
        <IconButton label="Close assistant" size="sm" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!suggestion && !missed && (
          <>
            <p className="text-[13px] leading-relaxed text-chalk-2">
              Describe the vibe you&apos;re after. I&apos;ll pick pieces that match,
              check they fit your room&apos;s real measurements, and place them.
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {STARTER_PROMPTS.map((p) => (
                <Chip
                  key={p}
                  onClick={() => {
                    setQuery(p);
                    run(p);
                  }}
                >
                  {p}
                </Chip>
              ))}
            </div>
          </>
        )}

        {missed && (
          <div className="rounded-[var(--radius-panel)] border border-white/8 bg-ink-2 p-4">
            <p className="text-[13px] font-medium text-chalk">
              I couldn&apos;t match that to anything in the catalog
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-chalk-3">
              Try naming an aesthetic — cozy, cyberpunk, anime, minimal, retro — or
              what you want more of, like lighting, plants or wall art.
            </p>
          </div>
        )}

        {suggestion && (
          <div className="space-y-4">
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                {suggestion.aesthetics.map((a) => (
                  <Badge key={a} tone="accent">
                    {aestheticById(a).label}
                  </Badge>
                ))}
              </div>
              <h3 className="mt-2.5 text-[18px] font-semibold tracking-[-0.025em]">
                {suggestion.title}
              </h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-chalk-3">
                {suggestion.rationale}
              </p>
            </div>

            <ul className="space-y-1">
              {suggestion.placements.map(({ product, item }) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-[12px] bg-white/4 p-2"
                >
                  <ProductThumb product={product} className="size-11 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-chalk">
                      {product.name}
                    </p>
                    <p className="text-[11px] text-chalk-4">
                      {item.surface
                        ? `On the ${item.surface} ${item.surface === "floor" || item.surface === "ceiling" ? "" : "wall"}`.trim()
                        : item.supportId
                          ? "Stacked on another piece"
                          : "Placed in your room"}
                    </p>
                  </div>
                  <span className="shrink-0 text-[12px] font-semibold text-chalk-2">
                    {formatINR(product.price)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between rounded-[12px] border border-white/8 px-3.5 py-2.5">
              <span className="text-[12px] text-chalk-3">
                {suggestion.placements.length} pieces
              </span>
              <span className="text-[14px] font-semibold">
                {formatINR(suggestion.totalPrice)}
              </span>
            </div>

            <Button
              variant={applied ? "secondary" : "primary"}
              className="w-full"
              onClick={apply}
              disabled={applied}
            >
              {applied ? (
                <>
                  <Check className="size-4" strokeWidth={2.6} />
                  Added to your room
                </>
              ) : (
                "Apply design suggestion"
              )}
            </Button>

            {applied && (
              <button
                onClick={() => {
                  setSuggestion(null);
                  setQuery("");
                  setApplied(false);
                  inputRef.current?.focus();
                }}
                className="w-full text-[12px] font-medium text-chalk-3 transition-colors hover:text-chalk"
              >
                Ask for something else
              </button>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
        className="border-t border-white/7 p-3"
      >
        <div className="relative">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Make my room more cozy…"
            className="h-11 w-full rounded-[13px] border border-white/10 bg-ink-2 pl-3.5 pr-11 text-[13.5px] text-chalk outline-none transition-colors placeholder:text-chalk-4 focus:border-accent/50"
          />
          <button
            type="submit"
            aria-label="Ask the assistant"
            disabled={!query.trim()}
            className={cn(
              "absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-[10px] transition-all",
              query.trim()
                ? "bg-accent text-black hover:opacity-90"
                : "bg-white/6 text-chalk-4",
            )}
          >
            <ArrowUp className="size-4" strokeWidth={2.4} />
          </button>
        </div>
      </form>
    </aside>
  );
}
