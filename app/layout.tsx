import type { Metadata, Viewport } from "next";
import { Quicksand } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";

// The wordmark is drawn in a rounded geometric sans; Quicksand is the
// closest open face, so the whole interface speaks in the logo's voice.
const quicksand = Quicksand({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-quicksand",
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
    <html lang="en" className={quicksand.variable}>
      <body className="min-h-dvh bg-ink-0 antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
