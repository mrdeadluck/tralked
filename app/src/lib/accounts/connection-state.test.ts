import { describe, expect, it } from "vitest";
import { connectionState, IMPORT_GRACE_MS } from "./connection-state";
import type { LinkedAccountView } from "./queries";

const NOW = new Date("2026-10-31T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function view(over: Partial<LinkedAccountView>): LinkedAccountView {
  return {
    platform: "psn",
    handle: "Lucas-Exemplo",
    verified: false,
    pendingCode: null,
    codeExpiresAt: null,
    lastSyncedAt: null,
    lastSyncAttemptAt: null,
    ...over,
  };
}

describe("connectionState", () => {
  it("is disconnected without a row", () => {
    expect(connectionState(undefined, NOW)).toEqual({ kind: "disconnected", expiredHandle: null });
  });

  it("is pending while the code is valid and disconnected (expired) afterwards", () => {
    const expiresAt = new Date(NOW.getTime() + 60_000);
    expect(connectionState(view({ pendingCode: "TRK-ABCDEF", codeExpiresAt: expiresAt }), NOW)).toEqual({
      kind: "pending",
      handle: "Lucas-Exemplo",
      code: "TRK-ABCDEF",
      expiresAt,
    });
    // getLinkedAccounts hides expired codes: an unverified row without code is an expired link.
    expect(connectionState(view({}), NOW)).toEqual({ kind: "disconnected", expiredHandle: "Lucas-Exemplo" });
  });

  it("only verified accounts are connected", () => {
    const synced = connectionState(view({ verified: true, lastSyncedAt: ago(60_000), lastSyncAttemptAt: ago(90_000) }), NOW);
    expect(synced).toMatchObject({ kind: "connected", importing: false, failed: false });
  });

  it("tells a running import from a failed one", () => {
    expect(connectionState(view({ verified: true }), NOW)).toMatchObject({ importing: true, failed: false });
    expect(connectionState(view({ verified: true, lastSyncAttemptAt: ago(60_000) }), NOW)).toMatchObject({
      importing: true,
      failed: false,
    });
    expect(
      connectionState(view({ verified: true, lastSyncedAt: ago(IMPORT_GRACE_MS * 3), lastSyncAttemptAt: ago(IMPORT_GRACE_MS * 2) }), NOW),
    ).toMatchObject({ importing: false, failed: true });
  });
});
