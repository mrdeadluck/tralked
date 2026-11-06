import { describe, expect, it } from "vitest";
import { assertReadOnly, readOnlyUrl } from "./read-only";

const DB = process.env.DATABASE_URL!;

describe("readOnlyUrl", () => {
  it("adds the read-only session option, keeping the other parameters and options", () => {
    const url = new URL(readOnlyUrl("postgresql://u:p@host:5432/db?sslmode=require"));
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("options")).toBe("-c default_transaction_read_only=on");
    const more = new URL(readOnlyUrl("postgresql://u:p@host/db?options=-c%20statement_timeout%3D5000"));
    expect(more.searchParams.get("options")).toBe("-c statement_timeout=5000 -c default_transaction_read_only=on");
  });

  it("opens sessions where SHOW says on and writes fail (test database)", async () => {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: readOnlyUrl(DB) });
    await client.connect();
    try {
      const show = await client.query<{ default_transaction_read_only: string }>("SHOW default_transaction_read_only");
      expect(show.rows[0].default_transaction_read_only).toBe("on");
      await expect(client.query(`UPDATE "User" SET "displayName" = "displayName" WHERE false`)).rejects.toThrow(/read-only/);
    } finally {
      await client.end();
    }
  });
});

describe("assertReadOnly", () => {
  it("passes only when the session says on", async () => {
    await expect(assertReadOnly(async () => "on")).resolves.toBeUndefined();
    await expect(assertReadOnly(async () => "off")).rejects.toThrow(/not read-only/);
  });
});
