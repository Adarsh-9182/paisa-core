"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";

/**
 * Dark-first theming. next-themes writes `data-theme="dark|light"` on <html>
 * before paint (no flash); the smooth body cross-fade is intentional, so we
 * do NOT disable transitions on change.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem={false}>
      {children}
    </NextThemeProvider>
  );
}
