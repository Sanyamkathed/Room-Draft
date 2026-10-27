import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RoomDraft — See your dream room before you buy anything",
  description:
    "Upload your room, get an accurate 3D version of it, and design it with aesthetic decor that scales and snaps like the real thing.",
  applicationName: "RoomDraft",
};

export const viewport: Viewport = {
  themeColor: "#1c1814",
  width: "device-width",
  initialScale: 1,
  // The studio is a direct-manipulation surface; browser pinch-zoom would
  // fight the camera controls for the same gesture.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body className="min-h-dvh bg-ink-0 antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
