import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ai, StructuredOpts } from "../src/ai/client.js";
import { clusterInputs, clusterItems, newStoryKey, openStories, storyKeyOf } from "../src/ai/cluster.js";
import { TRIAGE_CHUNK, triageItems, type Triage } from "../src/ai/triage.js";
import type { Source } from "../src/config.js";
import { openDb, type Db } from "../src/db.js";

const source = (over: Partial<Source> = {}): Source => ({
  id: "ign-br",
  name: "IGN Brasil",
  kind: "rss",
  url: "https://br.ign.com/feed.xml",
  tier: "portal",
  category: "GAMES",
  gamingFilter: false,
  active: true,
  ...over,
});

/** Fake `Ai` whose `structured` returns the queued responses in order, validated by the call's schema. */
function fakeAi(responses: unknown[]) {
  const calls: StructuredOpts<unknown>[] = [];
  const structured = vi.fn(async (opts: StructuredOpts<unknown>) => {
    calls.push(opts);
    if (responses.length === 0) throw new Error("unexpected structured call");
    return opts.schema.parse(responses.shift());
  });
  const ai = { structured } as unknown as Ai;
  return { ai, calls, structured };
}

const triageOut = (id: number, over: Partial<Triage> = {}): Triage => ({
  id,
  keep: true,
  category: "GAMES",
  games: ["Grand Theft Auto VI"],
  companies: ["Rockstar Games"],
  rumor: false,
  importance: 95,
  headlinePt: `GTA 6 ganha data de lançamento (${id})`,
  ...over,
});

describe("triageItems", () => {
  it("sends items in chunks of 50, sequentially, with the fast model at effort low", async () => {
    expect(TRIAGE_CHUNK).toBe(50);
    const items = Array.from({ length: 120 }, (_, i) => ({
      id: i + 1,
      title: `Title ${i + 1}`,
      summary: null,
      source: source(),
    }));
    const chunk = (from: number, to: number) => ({
      items: items.slice(from, to).map((it) => triageOut(it.id)),
    });
    let inFlight = 0;
    let maxInFlight = 0;
    const { ai, calls, structured } = fakeAi([chunk(0, 50), chunk(50, 100), chunk(100, 120)]);
    const inner = structured.getMockImplementation()!;
    structured.mockImplementation(async (opts) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      try {
        return await inner(opts);
      } finally {
        inFlight--;
      }
    });

    const out = await triageItems(ai, items, "live");

    expect(out).toHaveLength(120);
    expect(out.map((t) => t.id)).toEqual(items.map((i) => i.id));
    expect(calls).toHaveLength(3);
    expect(maxInFlight).toBe(1);
    expect(calls[0]!.user).toContain("Title 50");
    expect(calls[0]!.user).not.toContain("Title 51");
    expect(calls[2]!.user).toContain("Title 120");
    for (const c of calls) {
      expect(c.model).toBe("claude-haiku-5-5");
      expect(c.effort).toBe("low");
      expect(c.bucket).toBe("live");
      expect(c.fallbacks).toBeFalsy();
      expect(c.maxTokens ?? 16000).toBeLessThanOrEqual(16000);
      expect(c.system).toBe(calls[0]!.system);
    }
  });

  it("uses the given model and bucket", async () => {
    const { ai, calls } = fakeAi([{ items: [triageOut(1)] }]);
    await triageItems(ai, [{ id: 1, title: "x", summary: null, source: source() }], "backfill", {
      model: "claude-haiku-5-5-20261001",
    });
    expect(calls[0]!.model).toBe("claude-haiku-5-5-20261001");
    expect(calls[0]!.bucket).toBe("backfill");
  });

  it("states the drop rules and the Brazilian-audience importance in a fixed system prompt", async () => {
    const { ai, calls } = fakeAi([{ items: [triageOut(1)] }]);
    await triageItems(ai, [{ id: 1, title: "x", summary: null, source: source() }], "live");
    const system = calls[0]!.system.toLowerCase();
    for (const word of ["deal", "coupon", "listicle", "review", "sponsored", "gamingfilter", "brazil", "gta 6"]) {
      expect(system).toContain(word);
    }
    expect(calls[0]!.system).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  });

  it("puts the source name, tier, gamingFilter flag, title and summary in the user message", async () => {
    const { ai, calls } = fakeAi([{ items: [triageOut(1)] }]);
    await triageItems(
      ai,
      [{ id: 1, title: "Novo iPhone chega", summary: "Apple anuncia", source: source({ name: "TecMundo", tier: "outro", gamingFilter: true }) }],
      "live",
    );
    const user = calls[0]!.user;
    expect(user).toContain("TecMundo");
    expect(user).toContain("outro");
    expect(user).toContain('"gamingFilter":true');
    expect(user).toContain("Novo iPhone chega");
    expect(user).toContain("Apple anuncia");
  });

  it("ignores unknown and duplicate ids, omits unanswered items and clamps importance", async () => {
    const { ai } = fakeAi([
      {
        items: [
          triageOut(2, { importance: 140.6 }),
          triageOut(99),
          triageOut(2, { keep: false }),
          triageOut(3, { importance: -5 }),
        ],
      },
    ]);
    const items = [1, 2, 3].map((id) => ({ id, title: `t${id}`, summary: null, source: source() }));
    const out = await triageItems(ai, items, "live");
    expect(out.map((t) => t.id)).toEqual([2, 3]);
    expect(out[0]!.keep).toBe(true);
    expect(out[0]!.importance).toBe(100);
    expect(out[1]!.importance).toBe(0);
  });

  it("makes no call for an empty list", async () => {
    const { ai, structured } = fakeAi([]);
    expect(await triageItems(ai, [], "live")).toEqual([]);
    expect(structured).not.toHaveBeenCalled();
  });
});

describe("clusterItems", () => {
  const item = (id: number) => ({ id, headlinePt: `Rockstar confirma data de GTA 6 (${id})`, games: ["Grand Theft Auto VI"] });

  it("puts five items about the same fact, delivered in two calls, into one story", async () => {
    const { ai, calls } = fakeAi([
      { groups: [{ storyKey: null, headline: "Rockstar confirma data de GTA 6", itemIds: [1, 2, 3] }] },
      { groups: [{ storyKey: newStoryKey(1), headline: null, itemIds: [4, 5] }] },
    ]);

    const out = await clusterItems(ai, [1, 2, 3, 4, 5].map(item), [], "live", { chunkSize: 3 });

    expect(calls).toHaveLength(2);
    // The second call is given the story the first call opened.
    expect(calls[1]!.user).toContain(newStoryKey(1));
    expect(calls[1]!.user).toContain("Rockstar confirma data de GTA 6");
    expect(out).toEqual([
      { id: 1, storyKey: null, newHeadline: "Rockstar confirma data de GTA 6" },
      { id: 2, storyKey: newStoryKey(1) },
      { id: 3, storyKey: newStoryKey(1) },
      { id: 4, storyKey: newStoryKey(1) },
      { id: 5, storyKey: newStoryKey(1) },
    ]);
    expect(new Set(out.map(storyKeyOf)).size).toBe(1);
    for (const c of calls) {
      expect(c.model).toBe("claude-haiku-5-5");
      expect(c.effort).toBe("low");
      expect(c.fallbacks).toBeFalsy();
      expect(c.maxTokens ?? 16000).toBeLessThanOrEqual(16000);
      expect(c.system).toBe(calls[0]!.system);
    }
  });

  it("joins a later run's items to an open story passed in by the caller", async () => {
    const first = fakeAi([{ groups: [{ storyKey: null, headline: "GTA 6 tem data", itemIds: [1, 2, 3] }] }]);
    const run1 = await clusterItems(first.ai, [1, 2, 3].map(item), [], "live");
    const opened = { key: storyKeyOf(run1[0]!), headline: run1[0]!.newHeadline!, games: ["Grand Theft Auto VI"] };

    const second = fakeAi([{ groups: [{ storyKey: opened.key, headline: null, itemIds: [4, 5] }] }]);
    const run2 = await clusterItems(second.ai, [4, 5].map(item), [opened], "live");

    expect(second.calls[0]!.user).toContain(opened.key);
    expect(new Set([...run1, ...run2].map(storyKeyOf))).toEqual(new Set([opened.key]));
  });

  it("treats an item assigned to an unknown story key as a new story", async () => {
    const { ai } = fakeAi([{ groups: [{ storyKey: "ghost-story", headline: "Xbox anuncia portátil", itemIds: [7, 8] }] }]);
    const out = await clusterItems(ai, [item(7), item(8)], [{ key: "real", headline: "Outra", games: [] }], "live");
    expect(out).toEqual([
      { id: 7, storyKey: null, newHeadline: "Xbox anuncia portátil" },
      { id: 8, storyKey: newStoryKey(7) },
    ]);
  });

  it("makes every item the model leaves out a story of its own and ignores ids it invents", async () => {
    const { ai } = fakeAi([
      {
        groups: [
          { storyKey: "real", headline: null, itemIds: [1, 42] },
          { storyKey: null, headline: null, itemIds: [1, 2] },
        ],
      },
    ]);
    const out = await clusterItems(ai, [item(1), item(2), item(3)], [{ key: "real", headline: "Real", games: [] }], "live");
    expect(out).toEqual([
      { id: 1, storyKey: "real" },
      { id: 2, storyKey: null, newHeadline: item(2).headlinePt },
      { id: 3, storyKey: null, newHeadline: item(3).headlinePt },
    ]);
  });

  it("makes no call for an empty list", async () => {
    const { ai, structured } = fakeAi([]);
    expect(await clusterItems(ai, [], [], "live")).toEqual([]);
    expect(structured).not.toHaveBeenCalled();
  });
});

describe("triage then clustering", () => {
  it("never sends a dropped item to clustering", async () => {
    const items = [
      { id: 1, title: "GTA 6 ganha data", summary: null, source: source() },
      { id: 2, title: "Cupom: 70% off em fones", summary: null, source: source({ gamingFilter: true }) },
      { id: 3, title: "Rockstar confirma GTA 6 para maio", summary: null, source: source() },
    ];
    const { ai, calls } = fakeAi([
      {
        items: [
          triageOut(1),
          triageOut(2, { keep: false, headlinePt: "Fones com cupom de desconto", games: [] }),
          triageOut(3),
        ],
      },
      { groups: [{ storyKey: null, headline: "GTA 6 ganha data", itemIds: [1, 3, 2] }] },
    ]);

    const triaged = await triageItems(ai, items, "live");
    const out = await clusterItems(ai, clusterInputs(triaged), [], "live");

    expect(calls).toHaveLength(2);
    expect(calls[1]!.user).not.toContain("Fones com cupom");
    expect(calls[1]!.user).not.toContain('"id":2');
    expect(out.map((r) => r.id)).toEqual([1, 3]);
  });
});

describe("openStories", () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(":memory:");
  });

  it("counts only stories whose last item is within 72 h", () => {
    const now = new Date("2026-10-31T12:00:00Z");
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
    const story = (key: string, lastItemAt: string, games: string[] = []) =>
      db.upsertStory(
        { key, headline: `H ${key}`, category: "GAMES", score: 50, bomb: false, rumor: false, gamesJson: JSON.stringify(games), mode: "live", lastItemAt },
        now,
      );
    story("fresh", hoursAgo(1), ["Grand Theft Auto VI"]);
    story("edge", hoursAgo(72));
    story("stale", hoursAgo(72.01));
    story("future", new Date(now.getTime() + 3_600_000).toISOString());

    const open = openStories(db, now);
    expect(open.map((s) => s.key).sort()).toEqual(["edge", "fresh"]);
    expect(open.find((s) => s.key === "fresh")).toEqual({ key: "fresh", headline: "H fresh", games: ["Grand Theft Auto VI"] });
  });
});
