import { useState } from "react";
import { SearchIcon } from "../icons";
import { GlassCard } from "../cards";
import { PageHeading } from "../chrome";

type RecordBadge = { label: string; tone: "amber" | "cyan" | "neutral" };

const records: Array<{
  id: string;
  pair: string;
  timeframe: string;
  badge: RecordBadge;
  body: string;
  meta: string;
  dotClass: string;
  completed: boolean;
}> = [
  {
    id: "EURUSD-15M",
    pair: "EUR/USD",
    timeframe: "15m",
    badge: { label: "WAIT", tone: "amber" },
    body: "Range hold confirmed at 1.0842. Invalidation set at 1.0810.",
    meta: "Today, 14:30 UTC • Confidence 58% • All agents active",
    dotClass: "bg-[#1A3B8B]",
    completed: true,
  },
  {
    id: "GBPUSD-1H",
    pair: "GBP/USD",
    timeframe: "1h",
    badge: { label: "BUY", tone: "cyan" },
    body: "Upside break past 1.2980 validated by UK wage expansion.",
    meta: "Today, 10:15 UTC • Confidence 74% • High quality evidence",
    dotClass: "bg-[#04231B]",
    completed: true,
  },
  {
    id: "USDJPY-5M",
    pair: "USD/JPY",
    timeframe: "5m",
    badge: { label: "INSUFFICIENT", tone: "neutral" },
    body: "Spread widening exceeded risk envelope. Run suppressed.",
    meta: "Yesterday, 22:00 UTC • Aborted by Risk Manager",
    dotClass: "bg-[#24070B]",
    completed: false,
  },
];

const filters = ["All", "EUR/USD", "GBP/USD", "Completed"] as const;
type Filter = (typeof filters)[number];

const badgeClass: Record<RecordBadge["tone"], string> = {
  amber: "border-sp-amber bg-[#201503] text-sp-amber text-[11px] font-extrabold",
  cyan: "border-sp-cyan bg-[#04231B] text-sp-cyan text-[11px] font-extrabold",
  neutral: "border-[#26364B] bg-[#0A0F1A] text-sp-muted-2 text-[9.5px] font-bold",
};

export default function HistoryScreen() {
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const visible = records.filter((record) => {
    const matchesFilter =
      filter === "All" ||
      (filter === "Completed" ? record.completed : record.pair === filter);
    const needle = query.trim().toLowerCase();
    const matchesQuery =
      needle === "" ||
      `${record.pair} ${record.timeframe} ${record.body} ${record.meta}`.toLowerCase().includes(needle);
    return matchesFilter && matchesQuery;
  });

  function resetFilters() {
    setFilter("All");
    setQuery("");
    setStatus("Filters reset.");
  }

  function exportCsv() {
    const rows = [
      ["Pair", "Timeframe", "Assessment", "Detail", "Log"],
      ...visible.map((record) => [record.pair, record.timeframe, record.badge.label, record.body, record.meta]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "sentinel-prime-analysis-log.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${visible.length} demo record${visible.length === 1 ? "" : "s"} to CSV.`);
  }

  return (
    <>
      <PageHeading title="Analysis Archive" sub="Historical multi-agent logs and assessments" />

      <div className="mt-3 space-y-3 px-5">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-[13px] top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-sp-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter analyses by currency pair or date..."
            aria-label="Filter analyses by currency pair or date"
            className="h-9 w-full rounded-[10px] border border-sp-chip bg-sp-glass pl-[34px] pr-4 text-[12px] text-sp-text placeholder:text-sp-muted focus:border-sp-cyan focus:outline-none"
          />
        </div>

        <div className="flex gap-2.5 pt-[2px]">
          {filters.map((item) => {
            const active = item === filter;
            return (
              <button
                key={item}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(item)}
                className={`flex h-7 items-center justify-center rounded-[8px] px-3 text-[11.5px] ${
                  active
                    ? "border border-sp-cyan bg-sp-cyan/15 font-extrabold text-sp-cyan"
                    : "border border-sp-chip bg-sp-glass font-semibold text-sp-muted-2"
                }`}
              >
                {item}
              </button>
            );
          })}
        </div>

        <div className="space-y-2.5">
          {visible.map((record, index) => (
            <GlassCard
              key={record.id}
              radius={14}
              hero={index === 0}
              className="min-h-[92px] px-4 pb-4 pt-[12px]"
            >
              <div className="flex h-[22px] items-center">
                <span
                  aria-hidden="true"
                  className={`h-3 w-3 shrink-0 rounded-full ${record.dotClass}`}
                />
                <span className="ml-[6px] text-[13px] font-extrabold text-sp-text tabular-nums">
                  {record.pair} • {record.timeframe}
                </span>
                <span
                  className={`ml-auto flex h-[22px] items-center justify-center rounded-[6px] border px-[10px] ${badgeClass[record.badge.tone]}`}
                >
                  {record.badge.label}
                </span>
              </div>
              <p className="mt-[10px] text-[12px] leading-snug text-sp-soft">{record.body}</p>
              <p className="mt-[8px] text-[10.5px] text-sp-muted tabular-nums">{record.meta}</p>
            </GlassCard>
          ))}
          {visible.length === 0 && (
            <GlassCard radius={14} className="px-4 py-6 text-center">
              <p className="text-[12px] text-sp-soft">No analyses match these filters.</p>
              <p className="mt-1 text-[10.5px] text-sp-muted">
                Adjust the search text or pick a different filter chip.
              </p>
            </GlassCard>
          )}
        </div>

        {status && (
          <p role="status" className="text-[10.5px] text-sp-muted">
            {status}
          </p>
        )}
      </div>

      <div className="mt-auto flex gap-2.5 px-5 pb-[38px] pt-3">
        <button
          type="button"
          onClick={resetFilters}
          className="flex h-12 w-[170px] items-center justify-center rounded-[12px] border border-sp-line bg-sp-glass text-[13px] font-bold text-sp-muted-2 transition-colors hover:border-sp-muted"
        >
          Reset Filters
        </button>
        <button
          type="button"
          onClick={exportCsv}
          className="flex h-12 w-[170px] items-center justify-center rounded-[12px] border border-sp-cyan bg-sp-glass text-[13px] font-extrabold text-sp-cyan transition-colors hover:bg-sp-cyan/10"
        >
          Export CSV Log
        </button>
      </div>
    </>
  );
}
