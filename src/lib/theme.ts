/**
 * SENTINEL PRIME — THEME RESOLUTION (pure)
 *
 * Single source of truth for the dark-theme-mode default. Used by the
 * ThemeToggle component and asserted by TEST-THEME-* in the engine battery.
 * The inline bootstrap in index.html mirrors this exact rule
 * (resolveTheme(stored) === "dark"  <=>  stored !== "light").
 */

export const THEME_STORAGE_KEY = "sp-theme";

export type ThemeName = "dark" | "light";

/** Dark is the default. Only an explicit "light" opts out. */
export function resolveTheme(stored: string | null | undefined): ThemeName {
  return stored === "light" ? "light" : "dark";
}
