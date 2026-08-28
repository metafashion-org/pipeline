import type { Metadata } from "next";
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
  title: "MetaFashion - Task Kanban",
  description: "Task management board for MetaFashion",
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
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
