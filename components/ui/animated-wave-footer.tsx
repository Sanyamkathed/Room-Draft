"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Instagram, Mail } from "lucide-react";
import { Wordmark } from "@/components/brand/Logo";
import { Button } from "@/components/ui/primitives";
import { AESTHETICS } from "@/lib/catalog/types";
import { cn } from "@/lib/utils/cn";

const QUICK_LINKS = [
  { href: "/", label: "Home" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/shop", label: "Shop decor" },
  { href: "/spaces", label: "My spaces" },
  { href: "/onboarding", label: "Upload your room" },
];

const INSTAGRAM_URL = "https://www.instagram.com/room_draft";
const CONTACT_EMAIL = "roomdraft01@gmail.com";

/**
 * One wave period is 900 units wide and the strip holds two, so sliding it by
 * exactly half its width lands on an identical frame — the loop has no seam.
 */
const WAVE_BACK =
  "M0 260C150 180 300 180 450 260C600 340 750 340 900 260C1050 180 1200 180 1350 260C1500 340 1650 340 1800 260V500H0Z";
const WAVE_FRONT =
  "M0 300C150 350 300 350 450 300C600 250 750 250 900 300C1050 350 1200 350 1350 300C1500 250 1650 250 1800 300V500H0Z";

function SubscribeForm() {
  const [email, setEmail] = React.useState("");
  const [done, setDone] = React.useState(false);

  if (done) {
    return (
      <p className="flex items-center gap-2 rounded-[11px] border border-accent/30 bg-accent/8 px-3.5 py-3 text-[13px] text-chalk">
        <Check className="size-4 text-accent" strokeWidth={2.4} />
        Thanks — you&apos;re on the list.
      </p>
    );
  }

  return (
    <form
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        setDone(true);
      }}
    >
      <label htmlFor="footer-email" className="block text-[12px] text-chalk-2">
        Email
      </label>
      <input
        id="footer-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Enter your email"
        className="h-[42px] w-full rounded-[10px] border border-line-strong bg-ink-1/70 px-3 text-[13px] text-chalk outline-none backdrop-blur-[4px] placeholder:text-chalk-3 focus:border-accent focus:shadow-[0_0_0_3px_rgba(213,244,91,0.10)]"
      />
      <Button type="submit" variant="primary" className="w-full">
        Subscribe
        <ArrowRight className="size-3.5" />
      </Button>
    </form>
  );
}

export default function AnimatedWaveFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "relative isolate overflow-hidden bg-[linear-gradient(to_bottom,var(--color-ink-0)_0%,#2c241c_45%,#3a2d20_100%)] pt-24",
        className,
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        {/* At least twice the footer's width, so sliding it by half never shows an edge */}
        <div className="absolute bottom-0 left-0 h-[320px] w-[max(200%,3600px)] animate-wave md:h-[420px]">
          <svg
            className="h-full w-full"
            viewBox="0 0 1800 500"
            preserveAspectRatio="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d={WAVE_BACK} fill="currentColor" className="text-warm/[0.07]" />
            <path d={WAVE_FRONT} fill="currentColor" className="text-warm/[0.11]" />
          </svg>
        </div>
      </div>

      <div className="relative mx-auto w-[min(calc(100%-32px),1440px)] md:w-[min(calc(100%-64px),1440px)]">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <h2 className="mb-4 font-[family-name:var(--font-display)] text-[28px] font-normal leading-none tracking-[-0.03em] text-chalk">
              Stay connected
            </h2>
            <p className="mb-4 text-[13px] leading-relaxed text-chalk-3">
              New decor drops and room ideas, once in a while.
            </p>
            <SubscribeForm />
          </div>

          <div>
            <h3 className="mb-4 text-[15px] font-semibold text-chalk">Quick links</h3>
            <nav aria-label="Footer" className="space-y-2.5 text-[13px]">
              {QUICK_LINKS.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="block text-chalk-2 transition-colors hover:text-accent"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          <div>
            <h3 className="mb-4 text-[15px] font-semibold text-chalk">Aesthetics</h3>
            <nav aria-label="Aesthetics" className="space-y-2.5 text-[13px]">
              {AESTHETICS.slice(0, 5).map((a) => (
                <Link
                  key={a.id}
                  href={`/discover?theme=${a.id}`}
                  className="block text-chalk-2 transition-colors hover:text-accent"
                >
                  {a.label}
                </Link>
              ))}
            </nav>
          </div>

          <div>
            <h3 className="mb-4 text-[15px] font-semibold text-chalk">Contact us</h3>
            <address className="space-y-3 text-[13px] not-italic">
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="flex items-center gap-2.5 text-chalk-2 transition-colors hover:text-accent"
              >
                <Mail className="size-4 shrink-0" strokeWidth={1.8} />
                {CONTACT_EMAIL}
              </a>
              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2.5 text-chalk-2 transition-colors hover:text-accent"
              >
                <Instagram className="size-4 shrink-0" strokeWidth={1.8} />
                @room_draft
              </a>
            </address>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-line py-8 md:flex-row">
          <Wordmark className="h-5 w-auto text-chalk-2" />
          <p className="text-[12.5px] text-chalk-3">
            © {new Date().getFullYear()} RoomDraft. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
