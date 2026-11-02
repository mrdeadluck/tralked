import { describe, expect, it } from "vitest";
import { connectionState, IMPORT_GRACE_MS } from "./connection-state";
import type { LinkedAccountView } from "./queries";

const NOW = new Date("2026-10-31T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function view(over: Partial<LinkedAccountView>): LinkedAccountView {
  return {
    platform: "psn",
    active: false,
    handle: "Lucas-Exemplo",
    fieldValue: null,
    verified: false,
    verification: null,
    claimCode: null,
    claimExpiresAt: null,
    lastSyncedAt: null,
    lastSyncAttemptAt: null,
    ...over,
  };
}

const active = (over: Partial<LinkedAccountView> = {}) => view({ active: true, fieldValue: "Lucas-Exemplo", ...over });

describe("connectionState", () => {
  it("is disconnected without a row", () => {
    expect(connectionState(undefined, NOW)).toEqual({ kind: "disconnected", claim: null });
  });

  it("an inactive row is disconnected, with its claim while the code is valid", () => {
    const expiresAt = new Date(NOW.getTime() + 60_000);
    expect(connectionState(view({ claimCode: "TRK-ABCDEF", claimExpiresAt: expiresAt }), NOW)).toEqual({
      kind: "disconnected",
      claim: { handle: "Lucas-Exemplo", code: "TRK-ABCDEF", expiresAt },
    });
    expect(connectionState(view({}), NOW)).toEqual({ kind: "disconnected", claim: null });
  });

  it("every active connection is connected, typed in (unverified) or claimed (verified)", () => {
    const typed = connectionState(active({ lastSyncedAt: ago(60_000), lastSyncAttemptAt: ago(90_000) }), NOW);
    expect(typed).toMatchObject({ kind: "connected", value: "Lucas-Exemplo", verified: false, importing: false, failed: false });
    expect(connectionState(active({ verified: true }), NOW)).toMatchObject({ kind: "connected", verified: true });
  });

  it("tells a running import from a failed one", () => {
    expect(connectionState(active(), NOW)).toMatchObject({ importing: true, failed: false });
    expect(connectionState(active({ lastSyncAttemptAt: ago(60_000) }), NOW)).toMatchObject({
      importing: true,
      failed: false,
    });
    expect(
      connectionState(active({ lastSyncedAt: ago(IMPORT_GRACE_MS * 3), lastSyncAttemptAt: ago(IMPORT_GRACE_MS * 2) }), NOW),
    ).toMatchObject({ importing: false, failed: true });
  });

  it("carries a pending \"Verificar agora\" of an unverified connection only", () => {
    const verification = { code: "TRK-ABC234", expiresAt: new Date(NOW.getTime() + 60_000), failure: "code_missing" as const, checkedAt: ago(5_000) };
    expect(connectionState(active({ verification }), NOW)).toMatchObject({ kind: "connected", verified: false, verification });
    expect(connectionState(active({ verified: true, verification }), NOW)).toMatchObject({ verified: true, verification: null });
  });
});
