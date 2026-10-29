"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ExternalLink, Link2, LogOut, Plus, Search, X } from "lucide-react";
import { useProjects } from "@/lib/hooks/useProjects";
import { buildSampleProject } from "@/lib/sample/room";
import { storage } from "@/lib/storage/idb";
import { Button, Spinner, buttonClasses } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";

interface FeedPin {
  id: string;
  title: string;
  image: string;
  full: string;
  width: number;
  height: number;
  color: string | null;
  pinUrl: string;
}

interface Board {
  id: string;
  name: string;
  count: number | null;
}

type Status = { configured: boolean; connected: boolean };
type Scope = "board" | "pinterest" | "yours";

const ERRORS: Record<string, string> = {
  setup: "Pinterest isn't set up on this site yet.",
  denied: "Pinterest access wasn't approved, so nothing was connected.",
  state: "That sign-in link expired. Connect again.",
  token: "Pinterest didn't finish the sign-in. Connect again.",
};

export default function InspoPage() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh" />}>
      <Inspo />
    </React.Suspense>
  );
}

function Inspo() {
  const params = useSearchParams();
  const [status, setStatus] = React.useState<Status | null>(null);
  const [notice, setNotice] = React.useState<string | null>(ERRORS[params.get("error") ?? ""] ?? null);
  const [adding, setAdding] = React.useState<{ image: string; title: string } | null>(null);

  React.useEffect(() => {
    fetch("/api/pinterest/status")
      .then((r) => r.json())
      .then((s: Status) => setStatus(s))
      .catch(() => setStatus({ configured: false, connected: false }));
  }, []);

  const disconnect = async () => {
    await fetch("/api/pinterest/logout", { method: "POST" }).catch(() => null);
    setStatus((s) => (s ? { ...s, connected: false } : s));
  };

  return (
    <div className="mx-auto w-[min(calc(100%-32px),1440px)] py-10 md:w-[min(calc(100%-64px),1440px)] md:py-14">
      <header className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-display text-[clamp(44px,7vw,84px)]">
            Inspo, <span className="text-warm">straight from Pinterest.</span>
          </h1>
          <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-chalk-2">
            Your boards and saved Pins, in one feed. See something you love? Drop it
            into a room and RoomDraft builds it at real size.
          </p>
        </div>
        {status?.connected && (
          <Button variant="ghost" size="sm" onClick={() => void disconnect()} className="self-start md:self-auto">
            <LogOut className="size-3.5" />
            Disconnect Pinterest
          </Button>
        )}
      </header>

      {notice && (
        <p role="status" className="mb-6 flex items-start justify-between gap-3 rounded-[12px] border border-accent/30 bg-accent/8 px-4 py-3 text-[13.5px] text-chalk">
          {notice}
          <button aria-label="Dismiss" onClick={() => setNotice(null)} className="text-chalk-3 hover:text-chalk">
            <X className="size-4" />
          </button>
        </p>
      )}

      {status === null ? (
        <div className="grid min-h-[280px] place-items-center">
          <Spinner className="size-6" />
        </div>
      ) : status.connected ? (
        <Feed onAdd={setAdding} onExpired={() => setStatus({ ...status, connected: false })} />
      ) : (
        <Connect configured={status.configured} />
      )}

      <PasteLink onAdd={setAdding} />

      {adding && <RoomPicker pin={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

/* ---------------- not connected ---------------- */

function Connect({ configured }: { configured: boolean }) {
  return (
    <section className="grid gap-8 border-t border-line py-12 md:grid-cols-[1.1fr_1fr] md:items-center md:py-16">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-[clamp(28px,3.4vw,42px)] font-bold leading-[1] tracking-[-0.04em]">
          Connect your Pinterest
        </h2>
        <p className="mt-3 max-w-[48ch] text-[14.5px] leading-relaxed text-chalk-2">
          RoomDraft asks Pinterest for read-only access to your boards and Pins. It never
          posts, pins or changes anything, and you can disconnect at any time.{" "}
          <Link href="/privacy" className="text-chalk underline underline-offset-4 decoration-warm hover:text-warm">
            How we handle your data
          </Link>
        </p>
        {configured ? (
          <a href="/api/pinterest/login" className={buttonClasses("primary", "lg", "mt-7 group")}>
            Connect Pinterest
            <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
          </a>
        ) : (
          <p className="mt-7 max-w-[52ch] rounded-[12px] border border-line bg-ink-2 px-4 py-3 text-[13px] leading-relaxed text-chalk-3">
            Connecting Pinterest is almost ready on RoomDraft. Until then, paste any Pin link
            below and add it to a room.
          </p>
        )}
      </div>
      <ol className="space-y-4 text-[14px] text-chalk-2">
        {[
          "Connect once and your boards appear here.",
          "Pick a board, or search your Pins.",
          "Add a Pin to a room. It becomes a real-size item you can place.",
        ].map((t, i) => (
          <li key={t} className="flex items-baseline gap-4">
            <span className="font-[family-name:var(--font-display)] text-[28px] font-bold leading-none text-warm tabular-nums">
              {i + 1}
            </span>
            {t}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------------- the feed ---------------- */

function Feed({
  onAdd,
  onExpired,
}: {
  onAdd: (pin: { image: string; title: string }) => void;
  onExpired: () => void;
}) {
  const [boards, setBoards] = React.useState<Board[]>([]);
  const [board, setBoard] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [submitted, setSubmitted] = React.useState("");
  // Where a search looks: the person's own Pins, or all of Pinterest.
  const [mode, setMode] = React.useState<"mine" | "all">("mine");
  // All of Pinterest is a closed-beta API; false once Pinterest says no.
  const [allAvailable, setAllAvailable] = React.useState(true);
  const [pins, setPins] = React.useState<FeedPin[]>([]);
  const [bookmark, setBookmark] = React.useState<string | null>(null);
  const [scope, setScope] = React.useState<Scope>("yours");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/pinterest/boards")
      .then((r) => r.json())
      .then((d: { boards?: Board[] }) => setBoards(d.boards ?? []))
      .catch(() => null);
  }, []);

  const load = React.useCallback(
    async (more: string | null) => {
      setLoading(true);
      setError(null);
      const qs = new URLSearchParams();
      if (board) qs.set("board", board);
      else if (submitted) {
        qs.set("q", submitted);
        qs.set("mode", mode);
      }
      if (more) qs.set("bookmark", more);
      try {
        const res = await fetch(`/api/pinterest/pins?${qs}`);
        const data = (await res.json()) as {
          pins?: FeedPin[];
          bookmark?: string | null;
          scope?: Scope;
          error?: string;
          available?: boolean;
        };
        if (res.status === 401) {
          onExpired();
          return;
        }
        if (!res.ok) throw new Error(data.error ?? "Couldn't load Pins.");
        setPins((prev) => (more ? [...prev, ...(data.pins ?? [])] : data.pins ?? []));
        setBookmark(data.bookmark ?? null);
        setScope(data.scope ?? "yours");
        if (submitted && mode === "all") setAllAvailable(data.available !== false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load Pins.");
      } finally {
        setLoading(false);
      }
    },
    [board, submitted, mode, onExpired],
  );

  React.useEffect(() => {
    void load(null);
  }, [load]);

  const label =
    scope === "board"
      ? `Pins on ${boards.find((b) => b.id === board)?.name ?? "this board"}`
      : submitted
        ? scope === "pinterest"
          ? `Top Pins on Pinterest for “${submitted}”`
          : `Your Pins matching “${submitted}”`
        : "All your Pins";

  return (
    <section>
      <div className="sticky top-[66px] z-20 -mx-4 mb-6 border-b border-line bg-ink-0/90 px-4 py-3 backdrop-blur-[12px] md:top-[76px] md:-mx-8 md:px-8">
        <form
          role="search"
          className="relative mb-3 max-w-[520px]"
          onSubmit={(e) => {
            e.preventDefault();
            setBoard(null);
            setSubmitted(query.trim());
          }}
        >
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-chalk-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === "all"
                ? "Search all of Pinterest: boho bedroom, gaming desk…"
                : "Search your Pins: dark academia desk, neon bedroom…"
            }
            aria-label={mode === "all" ? "Search all of Pinterest" : "Search your Pins"}
            className="h-11 w-full rounded-[12px] border border-line bg-ink-2 pl-10 pr-3 text-[14px] text-chalk outline-none placeholder:text-chalk-3 focus:border-accent"
          />
        </form>
        <div role="radiogroup" aria-label="Search in" className="mb-3 inline-flex rounded-full border border-line bg-ink-2 p-1">
          {(
            [
              { id: "mine", label: "My Pins" },
              { id: "all", label: "All of Pinterest" },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => {
                setMode(m.id);
                // Re-run the current search in the new place.
                if (query.trim()) {
                  setBoard(null);
                  setSubmitted(query.trim());
                }
              }}
              className={cn(
                "h-8 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors",
                mode === m.id ? "bg-accent text-accent-ink" : "text-chalk-2 hover:text-chalk",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
          {[{ id: null as string | null, name: "All Pins" }, ...boards].map((b) => {
            const active = board === b.id && !(b.id === null && submitted);
            return (
              <button
                key={b.id ?? "all"}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setBoard(b.id);
                  setSubmitted("");
                  setQuery("");
                }}
                className={cn(
                  "h-8 shrink-0 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors",
                  active
                    ? "border-accent bg-accent text-accent-ink"
                    : "border-line text-chalk-2 hover:border-line-strong hover:text-chalk",
                )}
              >
                {b.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* The fallback panel names the search itself, so a heading promising Pins would mislead */}
      {!(submitted && mode === "all" && !allAvailable) && (
        <p className="mb-4 text-[13px] text-chalk-3">{label}</p>
      )}

      {submitted && mode === "all" && !allAvailable && !loading ? (
        <div className="rounded-[16px] border border-line bg-ink-2 px-5 py-7 text-center">
          <p className="text-[15px] font-semibold text-chalk">Search “{submitted}” on Pinterest</p>
          <p className="mx-auto mt-2 max-w-[52ch] text-[13.5px] leading-relaxed text-chalk-3">
            Pinterest only lets approved partner apps show its full search inside them, so this
            one opens on Pinterest. Find a Pin you love, copy its link, and paste it into{" "}
            <a href="#pin-link" className="font-semibold text-chalk underline underline-offset-4 decoration-warm">
              Got a Pin link already?
            </a>{" "}
            below to add it to a room.
          </p>
          <a
            href={`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(submitted)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses("primary", "md", "mt-5")}
          >
            Search on Pinterest
            <ExternalLink className="size-4" />
          </a>
        </div>
      ) : error ? (
        <p className="rounded-[12px] border border-line bg-ink-2 px-4 py-6 text-center text-[14px] text-chalk-2">
          {error}{" "}
          <button onClick={() => void load(null)} className="font-semibold text-accent hover:text-accent-hover">
            Try again
          </button>
        </p>
      ) : !loading && pins.length === 0 ? (
        <p className="rounded-[12px] border border-line bg-ink-2 px-4 py-10 text-center text-[14px] text-chalk-2">
          {submitted ? "No Pins match that. Try a shorter search." : "Nothing saved here yet. Save a few Pins on Pinterest and they'll show up."}
        </p>
      ) : (
        <div className="columns-2 gap-3 md:columns-3 lg:columns-4 xl:columns-5">
          {pins.map((p) => (
            <figure key={p.id} className="group relative mb-3 break-inside-avoid overflow-hidden rounded-[14px] bg-ink-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.image}
                alt={p.title}
                loading="lazy"
                width={p.width}
                height={p.height}
                style={{ backgroundColor: p.color ?? undefined }}
                className="block h-auto w-full"
              />
              <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-[linear-gradient(to_top,rgba(28,24,20,0.9),transparent)] p-2.5 pt-10 md:opacity-0 md:transition-opacity md:duration-200 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                <span className="line-clamp-2 text-[12px] leading-snug text-chalk">{p.title}</span>
                <button
                  type="button"
                  onClick={() => onAdd({ image: p.full, title: p.title })}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-accent px-3 text-[12px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
                >
                  <Plus className="size-3.5" strokeWidth={2.6} />
                  Add
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {loading && (
        <div className="grid place-items-center py-10">
          <Spinner className="size-6" />
        </div>
      )}
      {!loading && bookmark && (
        <div className="mt-6 grid place-items-center">
          <Button variant="outline" onClick={() => void load(bookmark)}>
            Load more Pins
          </Button>
        </div>
      )}
    </section>
  );
}

/* ---------------- paste a link (works without connecting) ---------------- */

function PasteLink({ onAdd }: { onAdd: (pin: { image: string; title: string }) => void }) {
  const [link, setLink] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  return (
    <section id="pin-link" className="mt-14 scroll-mt-28 border-t border-line pt-10">
      <h2 className="text-[19px] font-semibold tracking-[-0.02em]">Got a Pin link already?</h2>
      <p className="mt-1.5 text-[13.5px] text-chalk-3">
        Paste any Pinterest Pin, shop listing or image link and add it to a room.
      </p>
      <form
        className="mt-4 flex max-w-[640px] flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          let url: URL;
          try {
            url = new URL(link.trim());
          } catch {
            setError("Paste a full link starting with https://");
            return;
          }
          if (url.protocol !== "https:" && url.protocol !== "http:") {
            setError("Paste a full link starting with https://");
            return;
          }
          setError(null);
          onAdd({ image: url.toString(), title: "" });
        }}
      >
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-chalk-3" />
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            inputMode="url"
            placeholder="https://pin.it/…"
            aria-label="Pin or product link"
            aria-invalid={Boolean(error)}
            className="h-11 w-full rounded-[12px] border border-line bg-ink-2 pl-10 pr-3 text-[14px] text-chalk outline-none placeholder:text-chalk-3 focus:border-accent"
          />
        </div>
        <Button type="submit" variant="primary" disabled={!link.trim()} className="h-11">
          Add to a room
        </Button>
      </form>
      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
    </section>
  );
}

/* ---------------- choose which room ---------------- */

function RoomPicker({ pin, onClose }: { pin: { image: string; title: string }; onClose: () => void }) {
  const router = useRouter();
  const { projects, loading } = useProjects();
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const go = (id: string) => {
    const qs = new URLSearchParams({ pin: pin.image });
    if (pin.title) qs.set("title", pin.title);
    router.push(`/studio/${id}?${qs}`);
  };

  const sample = async () => {
    setBusy(true);
    const project = buildSampleProject();
    try {
      await storage.saveProject(project);
      go(project.id);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-end bg-black/70 backdrop-blur-[2px] md:place-items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to which room?"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] rounded-t-[22px] border border-line bg-ink-2 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.5)] md:rounded-[20px]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[18px] font-semibold tracking-[-0.02em]">Add to which room?</h2>
          <button onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-[9px] text-chalk-3 hover:bg-white/8 hover:text-chalk">
            <X className="size-4" />
          </button>
        </div>

        {loading ? (
          <div className="grid place-items-center py-8">
            <Spinner className="size-5" />
          </div>
        ) : (
          <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto">
            {(projects ?? []).map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => go(p.id)}
                  className="flex w-full items-center justify-between rounded-[12px] border border-line px-3.5 py-3 text-left text-[14px] transition-colors hover:border-accent/50 hover:bg-ink-3"
                >
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="shrink-0 text-[12px] text-chalk-3">{p.itemCount} items</span>
                </button>
              </li>
            ))}
            <li>
              <button
                onClick={() => void sample()}
                disabled={busy}
                className="flex w-full items-center justify-between rounded-[12px] border border-dashed border-line-strong px-3.5 py-3 text-left text-[14px] transition-colors hover:border-accent/50 hover:bg-ink-3 disabled:opacity-60"
              >
                <span className="font-medium">{busy ? "Opening the sample room…" : "A new sample room"}</span>
                <ArrowRight className="size-4 text-chalk-3" />
              </button>
            </li>
          </ul>
        )}

        <p className="mt-4 text-[12.5px] text-chalk-3">
          No room yet?{" "}
          <Link href="/onboarding" className="font-semibold text-accent hover:text-accent-hover">
            Upload a photo of yours
          </Link>
        </p>
      </div>
    </div>
  );
}
