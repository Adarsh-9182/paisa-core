import type { Metadata } from "next";
import { Inter, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme-provider";
import { QueryProvider } from "@/lib/query-provider";

const inter = Inter({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const geist = Geist({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Paisa — the operating system for financial intelligence",
  description: "An AI CFO that never guesses a number. Every figure is verified against your ledger.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`h-full antialiased ${inter.variable} ${geist.variable} ${geistMono.variable}`}
    >
      <body className="h-full">
        <ThemeProvider>
          <QueryProvider>{children}</QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
