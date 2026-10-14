import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Panel, RecordDetails } from "./shared";

export default function DataPanel() {
  const data = useQuery(api.console.data, {});
  if (data === undefined) return <p role="status">Loading market data…</p>;
  return (
    <Panel title="Market data" description="Chart design is pending. Existing deterministic simulation series, quality checks, and snapshots remain available.">
      {data.series.length === 0 && <p>No market series are available.</p>}
      {data.series.map((series) => <RecordDetails key={series.marketId} title={`${series.symbol}: ${series.points.length} points`} value={series} />)}
      <RecordDetails title="Markets and provenance" value={data.markets} />
      <RecordDetails title="Data quality reports" value={data.quality} />
      <RecordDetails title="Reproducible snapshots" value={data.snapshots} />
    </Panel>
  );
}
