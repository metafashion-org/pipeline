import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/ThemeProvider";

// Matches Catalog Intel's own font stack exactly (index.html: Inter for body,
// Space Grotesk for display/headings, JetBrains Mono for code/data) — not
// shadcn's stock Geist pairing, so the two apps in the same product read as
// one visual identity instead of two unrelated ones.
const sans = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const display = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Meta Fashion Pipeline",
  description: "Production pipeline for MetaFashion assets.",
};

// Stops iOS Safari zooming the page when a field is focused, which it does whenever an input
// renders below 16px, and keeps the layout inside the notch on a phone.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${sans.variable} ${display.variable} ${mono.variable} antialiased`}
      >
        {/* One theme for everyone. With a light/dark toggle each browser kept its own choice, so
            the app looked different from login to login. forcedTheme also overrides a choice an
            old toggle left in a browser's storage. */}
        <ThemeProvider attribute="class" forcedTheme="dark" disableTransitionOnChange>
          {children}
          {/* The toaster reads next-themes' stored choice, which an old toggle may have left as light. */}
          <Toaster theme="dark" />
        </ThemeProvider>
      </body>
    </html>
  );
}
