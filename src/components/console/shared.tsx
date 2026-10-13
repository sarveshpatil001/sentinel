import type { ReactNode } from "react";

export function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section><h2>{title}</h2>{description && <p>{description}</p>}{children}</section>;
}

export function RecordDetails({ title, value }: { title: string; value: unknown }) {
  return (
    <details>
      <summary>{title}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function ActionStatus({ busy, error, result }: { busy: boolean; error: string | null; result: unknown }) {
  return (
    <>
      {busy && <p role="status">Operation in progress…</p>}
      {error && <p role="alert">{error}</p>}
      {result !== undefined && <div role="status"><p>Operation result:</p><pre>{JSON.stringify(result, null, 2)}</pre></div>}
    </>
  );
}
