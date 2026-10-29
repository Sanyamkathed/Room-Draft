"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRight,
  Compass,
  Home,
  LayoutGrid,
  Pin,
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
  const isHome = pathname === "/";

  // The bar is clear while the page is at the top, so it blends into what's
  // behind it; once you scroll, a light frosted backing keeps it readable.
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
      {/* The bar floats over the page (negative bottom margin), so the
          homepage hero runs up underneath it instead of starting below a band. */}
      <header
        className={cn(
          "sticky top-0 z-40 -mb-[66px] flex h-[66px] items-center justify-between gap-6 border-b px-4 transition-[background-color,border-color,backdrop-filter] duration-300 md:-mb-[76px] md:h-[76px] md:px-[clamp(22px,3.4vw,52px)]",
          scrolled
            ? "border-line bg-ink-0/60 backdrop-blur-[14px]"
            : "border-transparent bg-transparent",
        )}
      >
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

        <div className="flex items-center">
          <Link
            href="/onboarding"
            className="group inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-[12px] bg-accent px-3 text-[12px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover md:px-4 md:text-[13px]"
          >
            Start designing
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </header>

      {/* Every page but home starts below the floating bar; the home hero sits under it. */}
      <main className={cn("min-w-0 flex-1", !isHome && "pt-[66px] md:pt-[76px]")}>{children}</main>

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
