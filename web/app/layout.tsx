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
  title: "MetaFashion Pipeline",
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
        {/* System is enabled because the mode toggle in the shell offers it. It was listed as a
            choice while enableSystem was false, so picking it did nothing. Dark stays the
            default for anyone who has not chosen. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
