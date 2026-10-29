"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowRight,
  Compass,
  Heart,
  Home,
  LayoutGrid,
  Pin,
  Search,
  ShoppingBag,
  User,
} from "lucide-react";
import { Wordmark } from "@/components/brand/Logo";
import AnimatedWaveFooter from "@/components/ui/animated-wave-footer";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { cn } from "@/lib/utils/cn";

/** Text links in the desktop header. */
const HEADER_NAV = [
  { href: "/shop", label: "Explore" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/discover", label: "Aesthetics" },
  { href: "/inspo", label: "Inspo" },
  { href: "/spaces", label: "My spaces" },
];

/** Icon tabs in the mobile bar, where there is no room for the header links. */
const TAB_NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/spaces", label: "My Spaces", icon: LayoutGrid },
  { href: "/inspo", label: "Inspo", icon: Pin },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/shop", label: "Shop", icon: ShoppingBag },
  { href: "/profile", label: "Profile", icon: User },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href.includes("#")) return false;
  return pathname.startsWith(href);
}

function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  return (
    <form
      role="search"
      className="relative hidden w-[min(300px,24vw)] lg:block"
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        router.push(term ? `/shop?q=${encodeURIComponent(term)}` : "/shop");
      }}
    >
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-chalk-3" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search furniture, decor, or styles..."
        aria-label="Search furniture, decor, or styles"
        className="h-10 w-full rounded-[11px] border border-line bg-ink-2/80 pl-10 pr-3 text-[12.5px] text-chalk placeholder:text-chalk-3 outline-none transition-colors focus:border-accent"
      />
    </form>
  );
}

/**
 * App chrome.
 *
 * The studio and onboarding take the whole viewport — a 3D editor competing
 * with a header for space is exactly the clutter the brief rules out — so both
 * routes opt out of the shell entirely.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const immersive = pathname.startsWith("/studio") || pathname.startsWith("/onboarding");

  if (immersive) return <>{children}</>;

  return (
    <div className="relative flex min-h-dvh flex-col">
      {/* Drifting brand light behind every page. The homepage hero paints its
          own picture over it; everything below shows it through. */}
      <AuroraBackground
        className="pointer-events-none fixed inset-0 -z-10"
        speed={0.35}
        blobCount={4}
      />
      <header className="sticky top-0 z-40 flex min-h-[66px] items-center justify-between gap-6 border-b border-line bg-ink-1/92 px-4 py-3 backdrop-blur-[16px] md:min-h-[76px] md:px-[clamp(22px,3.4vw,52px)]">
        <div className="flex items-center gap-[clamp(24px,4vw,64px)]">
          <Link href="/" aria-label="RoomDraft home" className="shrink-0 text-chalk">
            <Wordmark className="h-6 w-auto md:h-7" />
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-[clamp(16px,2.4vw,34px)] md:flex">
            {HEADER_NAV.map(({ href, label }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "whitespace-nowrap text-[13px] transition-colors duration-200",
                    active ? "text-chalk" : "text-chalk-2 hover:text-chalk",
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1.5 md:gap-3">
          <HeaderSearch />
          <Link
            href="/profile"
            aria-label="Saved pieces"
            className="hidden size-10 place-items-center rounded-[11px] text-chalk-2 transition-colors hover:bg-white/[0.04] hover:text-chalk md:grid"
          >
            <Heart className="size-[18px]" strokeWidth={1.8} />
          </Link>
          <Link
            href="/profile"
            aria-label="Profile"
            className="hidden size-10 place-items-center rounded-[11px] text-chalk-2 transition-colors hover:bg-white/[0.04] hover:text-chalk md:grid"
          >
            <User className="size-[18px]" strokeWidth={1.8} />
          </Link>
          <Link
            href="/onboarding"
            className="group inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-[12px] bg-accent px-3 text-[12px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover md:px-4 md:text-[13px]"
          >
            Start designing
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </header>

      <main className="min-w-0 flex-1">{children}</main>

      {/* Bottom padding clears the mobile tab bar */}
      <AnimatedWaveFooter className="pb-[72px] md:pb-0" />

      {/* Mobile tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-50 flex h-[68px] items-center justify-around border-t border-line bg-ink-1/95 backdrop-blur-[16px] md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TAB_NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors duration-200",
                active ? "text-accent" : "text-chalk-4",
              )}
            >
              <Icon className="size-[19px]" strokeWidth={active ? 2.2 : 1.8} />
              <span className="text-[10px] font-medium tracking-[-0.01em]">{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
