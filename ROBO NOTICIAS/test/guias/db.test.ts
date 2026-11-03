import { describe, expect, it } from "vitest";
import { openGuideDb } from "../../src/guias/db.js";

describe("openGuideDb", () => {
  it("creates the tables", () => {
    const db = openGuideDb(":memory:");
    const names = (db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (r) => r.name,
    );
    for (const t of ["pages", "runs", "spend", "dossiers", "meta", "alerts"]) expect(names).toContain(t);
  });

  it("stores and replaces pages, runs, dossiers, meta and alerts", () => {
    const db = openGuideDb(":memory:");
    const at = new Date("2026-11-03T10:00:00Z");
    db.savePage({ url: "https://a.test/x", fetchedAt: at, status: "ok", finalUrl: "https://a.test/y", text: "t", html: "<p>t</p>", contentHash: "h" });
    db.savePage({ url: "https://a.test/x", fetchedAt: at, status: "ok", finalUrl: "https://a.test/y", text: "t2", html: "<p>t2</p>", contentHash: "h2" });
    expect(db.getPage("https://a.test/x")).toMatchObject({ text: "t2", html: "<p>t2</p>", final_url: "https://a.test/y" });
    expect(db.getPage("https://nope.test/")).toBeUndefined();

    db.recordRun({ requestId: "r1", attempt: 1, startedAt: at, finishedAt: at, outcome: "ok" });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM runs").get()).toEqual({ n: 1 });

    db.saveDossier("r1", { a: 1 }, at);
    db.saveDossier("r1", { a: 2 }, at);
    expect(db.getDossier("r1")).toEqual({ a: 2 });

    db.setMeta("k", "v");
    expect(db.getMeta("k")).toBe("v");
    db.addAlert("boom", "msg", at);
    expect(db.alerts()).toHaveLength(1);
  });
});
