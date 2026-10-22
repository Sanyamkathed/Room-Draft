"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  Home,
  LayoutGrid,
  ShoppingBag,
  Sparkles,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/spaces", label: "My Spaces", icon: LayoutGrid },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/shop", label: "Shop", icon: ShoppingBag },
  { href: "/profile", label: "Profile", icon: User },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

/**
 * App chrome.
 *
 * The studio and onboarding take the whole viewport — a 3D editor competing
 * with a nav rail for horizontal space is exactly the clutter the brief rules
 * out — so both routes opt out of the shell entirely.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const immersive = pathname.startsWith("/studio") || pathname.startsWith("/onboarding");

  if (immersive) return <>{children}</>;

  return (
    <div className="flex min-h-dvh">
      {/* Desktop rail */}
      <nav
        aria-label="Main"
        className="hidden md:flex sticky top-0 h-dvh w-[76px] shrink-0 flex-col items-center gap-1 border-r border-white/7 bg-ink-1/60 py-5 backdrop-blur-xl"
      >
        <Link
          href="/"
          className="group mb-4 grid size-11 place-items-center rounded-[13px] bg-accent text-black transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-105"
          aria-label="AURA home"
        >
          <Sparkles className="size-5" strokeWidth={2.2} />
        </Link>

        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative grid size-11 place-items-center rounded-[13px] transition-all duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]",
                active ? "text-chalk" : "text-chalk-4 hover:text-chalk-2",
              )}
            >
              {active && (
                <span className="absolute inset-0 rounded-[13px] bg-white/8 ring-1 ring-white/10" />
              )}
              <Icon className="relative size-[19px]" strokeWidth={active ? 2.1 : 1.8} />

              {/* Label reveals on hover so the rail stays 76px at rest */}
              <span
                className={cn(
                  "pointer-events-none absolute left-[calc(100%+10px)] z-50 whitespace-nowrap rounded-[9px] px-2.5 py-1.5",
                  "glass-strong text-[12px] font-medium text-chalk edge-light",
                  "opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0",
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      <main className="min-w-0 flex-1 pb-[72px] md:pb-0">{children}</main>

      {/* Mobile tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-50 flex h-[68px] items-center justify-around border-t border-white/8 glass-strong md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {NAV.map(({ href, label, icon: Icon }) => {
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
