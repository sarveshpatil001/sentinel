import {
  checkDatabricksWorkspace,
  DATABRICKS_CHECK_TIMEOUT_MS,
  DATABRICKS_CURRENT_USER_PATH,
  validateDatabricksHost,
} from "../convex/lib/databricks";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}

function response(status: number, body: string, headers: HeadersInit = {}) {
  return new Response(body, { status, headers });
}

const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
const fetchMock: typeof fetch = async (input, init) => {
  calls.push({ input, init });
  return response(200, JSON.stringify({ id: "u-1", userName: "trader@example.com" }), {
    "content-type": "application/scim+json",
  });
};

check("DBX-001 accepts only a clean HTTPS workspace origin", validateDatabricksHost("https://acme.cloud.databricks.com")?.origin === "https://acme.cloud.databricks.com");
check("DBX-002 rejects non-HTTPS workspace host", validateDatabricksHost("http://acme.cloud.databricks.com") === null);
check("DBX-003 rejects host URLs with credentials, query, or path", validateDatabricksHost("https://name:secret@acme.cloud.databricks.com/path?x=y") === null);

const missing = await checkDatabricksWorkspace(undefined, "token", fetchMock);
check("DBX-004 missing host returns NOT_CONFIGURED without calling Databricks", !missing.ok && missing.status === "NOT_CONFIGURED" && calls.length === 0);
const badHost = await checkDatabricksWorkspace("http://localhost", "token", fetchMock);
check("DBX-005 malformed host returns UNKNOWN without calling Databricks", !badHost.ok && badHost.status === "UNKNOWN" && calls.length === 0);

const connected = await checkDatabricksWorkspace("https://acme.cloud.databricks.com", "server-token", fetchMock);
const req = calls[0];
const reqHeaders = new Headers(req?.init?.headers);
check("DBX-006 success requires a valid current-user body", connected.ok && connected.status === "CONNECTED");
check("DBX-007 sends only bounded read-only GET to the fixed current-user endpoint", req?.init?.method === "GET" && req.input.toString() === `https://acme.cloud.databricks.com${DATABRICKS_CURRENT_USER_PATH}` && req.init?.redirect === "error");
check("DBX-008 sends the token only as backend bearer auth", reqHeaders.get("authorization") === "Bearer server-token");
check("DBX-009 applies an abort timeout", req?.init?.signal instanceof AbortSignal && DATABRICKS_CHECK_TIMEOUT_MS === 8_000);

const cases: { name: string; fetcher: typeof fetch }[] = [
  { name: "non-200 response", fetcher: async () => response(204, "") },
  { name: "malformed JSON", fetcher: async () => response(200, "{" ) },
  { name: "missing current user identity", fetcher: async () => response(200, JSON.stringify({ id: "u-1" })) },
  { name: "wrong response shape", fetcher: async () => response(200, JSON.stringify({ Resources: [{ id: "u-1", userName: "x" }] })) },
  { name: "oversized declared response", fetcher: async () => response(200, "{}", { "content-length": "20000" }) },
  { name: "oversized streamed response", fetcher: async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(17_000)); controller.close(); } }), { status: 200 }) },
  { name: "network failure", fetcher: async () => { throw new Error("secret must not escape"); } },
];
for (const testCase of cases) {
  const result = await checkDatabricksWorkspace("https://acme.cloud.databricks.com", "server-token", testCase.fetcher);
  check(`DBX fail closed: ${testCase.name}`, !result.ok && result.status === "UNKNOWN");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
