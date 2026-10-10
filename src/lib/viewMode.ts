/**
 * SENTINEL PRIME — CONSOLE VIEW MODE (Simple vs Advanced)
 *
 * Provides a clean, friendly interface for normal people ("Simple" mode)
 * while preserving every audit, safety gate, and diagnostic capability
 * ("Advanced / Pro" mode) for institutional operators.
 *
 * Default is "simple" so normal users are not overwhelmed with
 * raw hash-chains, AST definitions, or dense governance tables.
 */

export const VIEW_MODE_STORAGE_KEY = "sp-view-mode";

export type ViewMode = "simple" | "advanced";

export function resolveViewMode(stored: string | null | undefined): ViewMode {
  return stored === "advanced" ? "advanced" : "simple";
}
