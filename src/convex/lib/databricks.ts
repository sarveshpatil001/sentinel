export const DATABRICKS_CURRENT_USER_PATH = "/api/2.0/preview/scim/v2/Me";
export const DATABRICKS_CHECK_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 16_384;

export type DatabricksCheckResult =
  | { ok: true; status: "CONNECTED"; note: string }
  | {
      ok: false;
      status: "NOT_CONFIGURED" | "UNKNOWN";
      note: string;
    };

export function validateDatabricksHost(host: string): URL | null {
  if (!host || host.trim() !== host) return null;
  try {
    const url = new URL(host);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function readBoundedBody(response: Response): Promise<string | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_RESPONSE_BYTES
    ) {
      return null;
    }
  }

  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function isCurrentUser(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.trim().length > 0 &&
    typeof record.userName === "string" &&
    record.userName.trim().length > 0
  );
}

export async function checkDatabricksWorkspace(
  host: string | undefined,
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<DatabricksCheckResult> {
  if (!host?.trim() || !token?.trim()) {
    return {
      ok: false,
      status: "NOT_CONFIGURED",
      note: "Databricks is not set up yet. Add its host and access token in the Keys tab.",
    };
  }

  const baseUrl = validateDatabricksHost(host.trim());
  if (!baseUrl) {
    return {
      ok: false,
      status: "UNKNOWN",
      note: "The Databricks host is not a valid HTTPS workspace URL.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DATABRICKS_CHECK_TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      new URL(DATABRICKS_CURRENT_USER_PATH, baseUrl),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          Accept: "application/scim+json, application/json",
        },
        signal: controller.signal,
        redirect: "error",
      },
    );

    if (response.status !== 200) {
      return {
        ok: false,
        status: "UNKNOWN",
        note: "Databricks did not confirm access. Check the host, token, and token permissions.",
      };
    }

    const text = await readBoundedBody(response);
    if (text === null || text.length === 0) {
      return {
        ok: false,
        status: "UNKNOWN",
        note: "Databricks returned unexpected user details. Access could not be confirmed.",
      };
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return {
        ok: false,
        status: "UNKNOWN",
        note: "Databricks returned an unreadable response. Access could not be confirmed.",
      };
    }

    if (!isCurrentUser(body)) {
      return {
        ok: false,
        status: "UNKNOWN",
        note: "Databricks returned unexpected user details. Access could not be confirmed.",
      };
    }

    return {
      ok: true,
      status: "CONNECTED",
      note: "Databricks access confirmed. This check does not grant or use trading access.",
    };
  } catch {
    return {
      ok: false,
      status: "UNKNOWN",
      note: "Could not reach Databricks. Check the host and try again.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
