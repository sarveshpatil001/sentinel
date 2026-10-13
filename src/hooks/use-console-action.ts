import { useRef, useState } from "react";

export function useConsoleAction() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setResult(undefined);
    setError(null);
    try {
      const response = await action();
      setResult(response);
      return response;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The operation could not be completed.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { busy, result, error, run };
}
