import { describe, expect, it } from "vitest";
import { dbFailureKind, describeError, isConnectionError, rethrowIfDatabaseDown } from "./errors";

/** Shapes as Prisma 7 + @prisma/adapter-pg throw them (see node_modules/@prisma/adapter-pg). */
function prismaKnown(code: string, message: string, extra: Record<string, unknown> = {}) {
  const error = new Error(message) as Error & Record<string, unknown>;
  error.name = "PrismaClientKnownRequestError";
  Object.assign(error, { code, clientVersion: "7.10.1", ...extra });
  return error;
}

function adapterError(cause: Record<string, unknown>) {
  const error = new Error(typeof cause.message === "string" ? cause.message : String(cause.kind));
  error.name = "DriverAdapterError";
  (error as Error & { cause: unknown }).cause = cause;
  return error;
}

function socketError(code: string, syscall = "read") {
  return Object.assign(new Error(`${syscall} ${code}`), { code, syscall, errno: -104 });
}

describe("describeError", () => {
  it("shows name, code, message, meta and every cause of a Prisma error", () => {
    const error = prismaKnown("P1017", "\nInvalid `prisma.game.update()` invocation:\n\n\nServer has closed the connection.", {
      meta: { modelName: "Game", driverAdapterError: { kind: "ConnectionClosed" } },
      cause: adapterError({ kind: "ConnectionClosed" }),
    });
    const text = describeError(error, { stack: false });
    expect(text).toContain("PrismaClientKnownRequestError [P1017]: Invalid `prisma.game.update()` invocation: Server has closed the connection.");
    expect(text).toContain('meta={"modelName":"Game","driverAdapterError":{"kind":"ConnectionClosed"}}');
    expect(text).toContain("cause: DriverAdapterError: ConnectionClosed");
    expect(text).toContain('cause: Object {"kind":"ConnectionClosed"}');
  });

  it("never prints an empty line for an AggregateError (Node's connect when every address fails)", () => {
    const aggregate = Object.assign(new AggregateError([socketError("ECONNREFUSED", "connect"), socketError("ETIMEDOUT", "connect")], ""), {
      code: "ECONNREFUSED",
    });
    const text = describeError(aggregate, { stack: false });
    expect(text.split("\n")[0]).toBe("AggregateError [ECONNREFUSED]: (no message)");
    expect(text).toContain("[0] Error [ECONNREFUSED]: connect ECONNREFUSED (syscall=connect, errno=-104)");
    expect(text).toContain("[1] Error [ETIMEDOUT]: connect ETIMEDOUT");
  });

  it("keeps pg's fields and a few stack frames", () => {
    const pg = Object.assign(new Error("terminating connection due to administrator command"), {
      code: "57P01",
      severity: "FATAL",
      routine: "ProcessInterrupts",
    });
    const text = describeError(pg);
    expect(text).toContain("Error [57P01]: terminating connection due to administrator command (severity=FATAL, routine=ProcessInterrupts)");
    const frames = text.split("\n").filter((line) => line.trim().startsWith("at "));
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.length).toBeLessThanOrEqual(6);
  });

  it("handles anything thrown: strings, plain objects, null, cycles", () => {
    expect(describeError("boom")).toBe("boom");
    expect(describeError(null)).toBe("(object) null");
    expect(describeError(undefined)).toBe("(undefined) undefined");
    expect(describeError({ status: 503 })).toBe('Object {"status":503}');
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b", { cause: a });
    a.cause = b;
    const text = describeError(a, { stack: false });
    expect(text).toContain("cause: Error: b");
    expect(text).toContain("[circular]");
  });
});

describe("dbFailureKind", () => {
  it.each([
    ["Prisma P1017 (server closed the connection)", prismaKnown("P1017", "Server has closed the connection.")],
    ["Prisma P1001 (can't reach)", prismaKnown("P1001", "Can't reach database server at `x:5432`")],
    ["adapter ConnectionClosed", adapterError({ kind: "ConnectionClosed" })],
    ["adapter DatabaseNotReachable", adapterError({ kind: "DatabaseNotReachable", host: "neon", port: 5432 })],
    ["pg admin shutdown via the adapter", adapterError({ kind: "postgres", code: "57P01", originalCode: "57P01", message: "terminating connection due to administrator command" })],
    ["pg raw", new Error("Connection terminated unexpectedly")],
    ["pg connect timeout", new Error("Connection terminated due to connection timeout")],
    ["pg errored client", new Error("Client has encountered a connection error and is not queryable")],
    ["socket reset", socketError("ECONNRESET")],
    ["broken pipe", socketError("EPIPE", "write")],
    ["class 08 code", Object.assign(new Error("connection failure"), { code: "08006", severity: "FATAL" })],
    ["Neon wake-up", new Error("Couldn't connect to compute node")],
    ["empty AggregateError", Object.assign(new AggregateError([socketError("ECONNREFUSED", "connect")], ""), { code: "ECONNREFUSED" })],
    [
      "Prisma P2010 with the driver's error in meta",
      prismaKnown("P2010", "Raw query failed.", {
        meta: { driverAdapterError: { name: "DriverAdapterError", cause: { kind: "postgres", code: "57P02", originalCode: "57P02" } } },
      }),
    ],
    ["wrapped", new Error("sync failed", { cause: prismaKnown("P1017", "Server has closed the connection.") })],
  ])("%s is a lost connection", (_label, error) => {
    expect(dbFailureKind(error)).toBe("connection");
    expect(isConnectionError(error)).toBe(true);
  });

  it.each([
    ["compute quota", new Error("Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits.")],
    ["disabled endpoint", new Error("The endpoint has been disabled. Enable it using Neon API and retry.")],
    ["storage full", adapterError({ kind: "postgres", code: "53100", message: "could not extend file because project size limit (1024 MB) has been exceeded" })],
  ])("%s is Neon refusing us", (_label, error) => {
    expect(dbFailureKind(error)).toBe("quota");
  });

  it.each([
    ["unique violation", prismaKnown("P2002", "Unique constraint failed on the fields: (`slug`)")],
    ["record not found", prismaKnown("P2025", "No record was found for an update.")],
    ["Steam unreachable (fetch)", new TypeError("fetch failed", { cause: socketError("ECONNRESET") })],
    ["HTTP timeout", Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })],
    ["plain bug", new TypeError("Cannot read properties of undefined (reading 'id')")],
    ["a string", "nope"],
    ["nothing", undefined],
  ])("%s is not a database failure", (_label, error) => {
    expect(dbFailureKind(error)).toBeNull();
  });

  it("rethrowIfDatabaseDown lets item errors through and sends database failures up", () => {
    expect(() => rethrowIfDatabaseDown(prismaKnown("P2002", "dup"))).not.toThrow();
    const lost = prismaKnown("P1017", "Server has closed the connection.");
    expect(() => rethrowIfDatabaseDown(lost)).toThrow(lost);
  });
});
