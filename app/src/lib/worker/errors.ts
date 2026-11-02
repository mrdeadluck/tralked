/**
 * Errors of the background workers (scripts/*-worker.ts on GitHub Actions): a full description for
 * the logs, and what kind of database failure an error is, so a worker can wait for the database
 * instead of dying (lib/worker/db-retry.ts).
 */

/** Causes followed below the top error (Prisma → DriverAdapterError → pg → socket). */
const MAX_DEPTH = 6;
/** Stack frames kept: where it broke, not the whole runtime. */
const STACK_FRAMES = 6;
const MAX_MESSAGE = 600;
const MAX_JSON = 400;

type Bag = Record<string, unknown>;

const isObject = (value: unknown): value is Bag => typeof value === "object" && value !== null;

function json(value: unknown, max = MAX_JSON): string {
  const seen = new WeakSet<object>();
  let text: string;
  try {
    text = JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === "bigint") return `${v}n`;
      if (isObject(v)) {
        if (seen.has(v)) return "[circular]";
        seen.add(v);
      }
      return v;
    });
  } catch {
    text = String(value);
  }
  text ??= String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const oneLine = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_MESSAGE ? `${flat.slice(0, MAX_MESSAGE)}…` : flat;
};

/** Fields worth a log line, from Prisma (code, meta), pg (severity, detail…) and Node (syscall…). */
const DETAIL_KEYS = [
  "errorCode",
  "kind",
  "originalCode",
  "originalMessage",
  "severity",
  "detail",
  "hint",
  "routine",
  "syscall",
  "errno",
  "address",
  "hostname",
  "host",
  "port",
] as const;

/** `Name [code]: message key=value… meta={…}` for one link of the chain. */
function head(value: unknown): string {
  if (!isObject(value)) return `${typeof value === "string" ? "" : `(${typeof value}) `}${oneLine(String(value)) || "(empty)"}`;
  const name =
    value instanceof Error
      ? value.name || value.constructor?.name || "Error"
      : value.constructor && value.constructor !== Object
        ? value.constructor.name
        : "Object";
  // A plain object (DriverAdapterError's cause is one): all of it, it is small.
  if (!(value instanceof Error)) return `${name} ${json(value)}`;
  const code = typeof value.code === "string" || typeof value.code === "number" ? ` [${value.code}]` : "";
  const message = typeof value.message === "string" ? oneLine(value.message) : "";
  const details = DETAIL_KEYS.flatMap((key) => {
    const v = value[key];
    if (v === undefined || v === null || v === "") return [];
    if (key === "originalMessage" && v === value.message) return [];
    return [`${key}=${typeof v === "string" ? oneLine(v) : json(v, 120)}`];
  });
  if (value.meta !== undefined) details.push(`meta=${json(value.meta)}`);
  return `${name}${code}: ${message || "(no message)"}${details.length ? ` (${details.join(", ")})` : ""}`;
}

function stackOf(error: unknown): string[] {
  if (!(error instanceof Error) || typeof error.stack !== "string") return [];
  return error.stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .slice(0, STACK_FRAMES);
}

/**
 * The whole error for a log: name, code and message of the error and of each cause below it
 * (Prisma error → DriverAdapterError → pg → socket), the members of an AggregateError (Node's
 * connect throws one with an empty message when every address fails), Prisma's `meta` and the
 * first stack frames. Never throws; works for anything thrown (strings, plain objects).
 */
export function describeError(error: unknown, { stack = true }: { stack?: boolean } = {}): string {
  const lines: string[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number, label: string) => {
    if (depth > MAX_DEPTH) return;
    if (isObject(value)) {
      if (seen.has(value)) return void lines.push(`${"  ".repeat(depth)}${label}[circular]`);
      seen.add(value);
    }
    lines.push(`${"  ".repeat(depth)}${label}${head(value)}`);
    if (!isObject(value)) return;
    if (Array.isArray(value.errors)) {
      value.errors.slice(0, 5).forEach((inner, i) => visit(inner, depth + 1, `[${i}] `));
    }
    if (value.cause !== undefined) visit(value.cause, depth + 1, "cause: ");
  };
  visit(error, 0, "");
  if (stack) {
    const frames = stackOf(error);
    if (frames.length) lines.push(...frames.map((frame) => `    ${frame}`));
  }
  return lines.join("\n");
}

/** Every link of an error: itself, its causes and the members of AggregateErrors. */
function links(error: unknown): Bag[] {
  const out: Bag[] = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number) => {
    if (!isObject(value) || seen.has(value) || depth > MAX_DEPTH) return;
    seen.add(value);
    out.push(value);
    if (Array.isArray(value.errors)) value.errors.forEach((inner) => walk(inner, depth + 1));
    walk(value.cause, depth + 1);
    // Prisma keeps the driver's error in `meta` (a raw query failing with Postgres 57P01 is P2010).
    if (isObject(value.meta)) walk(value.meta.driverAdapterError, depth + 1);
  };
  walk(error, 0);
  return out;
}

/**
 * Prisma codes of a lost or unreachable database: P1001 can't reach, P1002 timed out, P1008
 * socket timeout, P1017 server closed the connection, P2024 pool timeout, P2037 too many
 * connections.
 */
const PRISMA_CONNECTION_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2037"]);
/** Socket errors (pg rethrows the ones the adapter does not map). */
const SOCKET_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
]);
/** Postgres: admin/crash shutdown, cannot connect now, too many connections; class 08 = connection. */
const PG_CONNECTION_CODES = new Set(["57P01", "57P02", "57P03", "53300"]);
/** Driver adapter error kinds (@prisma/driver-adapter-utils) of a lost database. */
const ADAPTER_KINDS = new Set(["DatabaseNotReachable", "ConnectionClosed", "SocketTimeout", "TooManyConnections"]);
const CONNECTION_MESSAGE =
  /connection terminated|connection ended unexpectedly|terminating connection|server closed the connection|server has closed the connection|can't reach database server|timeout exceeded when trying to connect|encountered a connection error|not queryable|connection (?:is )?closed|couldn't connect to compute|socket hang up|read ECONNRESET|connect ECONNREFUSED|connect ETIMEDOUT/i;
/** Neon refusing to run the compute: the month's quota is spent or the endpoint was disabled. */
const QUOTA_MESSAGE =
  /exceeded the (?:compute time |data transfer |written data )?quota|compute time quota|endpoint (?:has been|is) disabled|project size limit/i;

/** HTTP calls (Steam, IGDB) fail with socket codes too: those are not the database. */
const isFetchFailure = (link: Bag) =>
  link.name === "AbortError" ||
  link.name === "TimeoutError" ||
  (typeof link.code === "string" && link.code.startsWith("UND_ERR")) ||
  (typeof link.message === "string" && /^fetch failed/i.test(link.message));

const codeOf = (link: Bag, key: "code" | "originalCode") => (typeof link[key] === "string" ? (link[key] as string) : "");

/**
 * What kind of database failure an error is:
 * - `quota`: Neon refuses the compute (monthly quota spent, endpoint disabled, storage full);
 *   retrying is pointless until it is lifted;
 * - `connection`: the connection dropped or the database cannot be reached right now (Neon
 *   suspending or waking the compute, a network blip, a restart): worth waiting and retrying;
 * - null: anything else (a bad query, a failed HTTP call to Steam…).
 */
export function dbFailureKind(error: unknown): "connection" | "quota" | null {
  const chain = links(error);
  if (chain.length === 0) return typeof error === "string" && CONNECTION_MESSAGE.test(error) ? "connection" : null;
  if (chain.some((link) => typeof link.message === "string" && QUOTA_MESSAGE.test(link.message))) return "quota";
  if (chain.some(isFetchFailure)) return null;
  const connection = chain.some((link) => {
    const code = codeOf(link, "code");
    const original = codeOf(link, "originalCode");
    return (
      PRISMA_CONNECTION_CODES.has(code) ||
      SOCKET_CODES.has(code) ||
      [code, original].some((c) => PG_CONNECTION_CODES.has(c) || /^08[0-9A-Z]{3}$/.test(c)) ||
      (typeof link.kind === "string" && ADAPTER_KINDS.has(link.kind)) ||
      (typeof link.message === "string" && CONNECTION_MESSAGE.test(link.message))
    );
  });
  return connection ? "connection" : null;
}

export const isConnectionError = (error: unknown) => dbFailureKind(error) === "connection";

/**
 * For the per-item catches of a worker: a database failure is not the item's fault, so it goes up
 * to the run's retry (lib/worker/db-retry.ts) instead of being counted as a failed item.
 */
export function rethrowIfDatabaseDown(error: unknown): void {
  if (dbFailureKind(error) !== null) throw error;
}
