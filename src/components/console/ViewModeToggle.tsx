import { useEffect, useState } from "react";
import { Sparkles, SlidersHorizontal } from "lucide-react";
import { VIEW_MODE_STORAGE_KEY, ViewMode, resolveViewMode } from "@/lib/viewMode";

export function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  const isSimple = mode === "simple";

  return (
    <div className="inline-flex items-center rounded-lg border border-border/70 bg-card p-0.5 text-xs shadow-sm">
      <button
        type="button"
        onClick={() => onChange("simple")}
        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-all ${
          isSimple
            ? "bg-primary text-primary-foreground shadow-xs"
            : "text-muted-foreground hover:text-foreground"
        }`}
        title="Simple mode: friendly, clean interface hiding unnecessary engineering jargon"
      >
        <Sparkles className="size-3.5" />
        <span>Simple</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("advanced")}
        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-all ${
          !isSimple
            ? "bg-primary text-primary-foreground shadow-xs"
            : "text-muted-foreground hover:text-foreground"
        }`}
        title="Pro mode: shows full audit hash-chains, raw telemetry, and engine internals"
      >
        <SlidersHorizontal className="size-3.5" />
        <span>Pro</span>
      </button>
    </div>
  );
}

export function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      return resolveViewMode(localStorage.getItem(VIEW_MODE_STORAGE_KEY));
    } catch {
      return "simple";
    }
  });

  const updateMode = (next: ViewMode) => {
    setMode(next);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
    } catch {
      // storage unavailable
    }
  };

  return [mode, updateMode];
}
