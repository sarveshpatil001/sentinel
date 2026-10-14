import type { ReactNode } from "react";

const radiusClass: Record<number, string> = {
  12: "rounded-[12px]",
  14: "rounded-[14px]",
  16: "rounded-[16px]",
};

export function GlassCard({
  children,
  radius = 12,
  hero = false,
  accent = "default",
  className = "",
}: {
  children: ReactNode;
  radius?: 12 | 14 | 16;
  hero?: boolean;
  accent?: "default" | "amber";
  className?: string;
}) {
  const borderClass = accent === "amber" ? "border-sp-amber/40" : hero ? "border-sp-line-hero" : "border-sp-line";
  return (
    <section
      className={`relative overflow-hidden border bg-linear-to-b from-sp-glass to-sp-glass-deep ${radiusClass[radius]} ${borderClass} ${className}`}
    >
      {hero && (
        <div
          aria-hidden="true"
          className="absolute inset-x-5 top-0 h-px bg-linear-to-r from-transparent via-white/20 to-transparent"
        />
      )}
      {children}
    </section>
  );
}

export function MicroLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-[11px] font-semibold tracking-[0.6px] text-sp-muted ${className}`}>{children}</p>
  );
}

const valueTone: Record<string, string> = {
  default: "text-sp-text",
  cyan: "text-sp-cyan",
  red: "text-sp-red",
  amber: "text-sp-amber",
};

const noteTone: Record<string, string> = {
  default: "text-sp-muted",
  cyan: "text-sp-cyan",
};

export function StatCard({
  label,
  value,
  note,
  tone = "default",
  noteTone: noteToneKey = "default",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "default" | "cyan" | "red" | "amber";
  noteTone?: "default" | "cyan";
}) {
  return (
    <GlassCard radius={12} className="flex h-16 flex-col justify-center gap-[3px] px-[14px]">
      <p className="text-[11px] font-semibold text-sp-muted">{label}</p>
      <p className={`text-[14px] font-extrabold tabular-nums ${valueTone[tone]}`}>{value}</p>
      <p className={`text-[9.5px] ${noteTone[noteToneKey]}`}>{note}</p>
    </GlassCard>
  );
}

export function StatusRow({ tone, children }: { tone: "cyan" | "amber"; children: ReactNode }) {
  return (
    <li className="flex items-start gap-[10px]">
      <span
        aria-hidden="true"
        className={`mt-[6px] h-[5px] w-[5px] shrink-0 rounded-full ${tone === "cyan" ? "bg-sp-cyan" : "bg-sp-amber"}`}
      />
      <span className="text-[11px] leading-[1.45] text-sp-soft">{children}</span>
    </li>
  );
}
