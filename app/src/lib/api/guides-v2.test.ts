/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies of the API */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidateTag,
}));

const { prisma } = await import("@/lib/db");
const { createApiKey } = await import("@/lib/api/keys");
const { resetRateLimits } = await import("@/lib/api/rate-limit");
const { applyPendingUpdate, discardPendingUpdate } = await import("@/lib/api/guide-pending");
const { setGuideStatus } = await import("@/lib/admin/guides");
const guides = await import("@/app/api/v1/guides/route");
const guideById = await import("@/app/api/v1/guides/[id]/route");
const dossier = await import("@/app/api/v1/games/[slug]/dossie/route");

const FIXTURE = fileURLToPath(new URL("../../../../ROBO NOTICIAS/test/guias/fixtures/walkthrough-pbz.json", import.meta.url));
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, any>;

const PREFIX = "rg-t2-";
const BASE = "http://localhost:3000";
let seq = 0;
type Key = { id: string; secret: string };
const keys = {} as { robot: Key; publisher: Key; reader: Key };
let editorId = "";

function call(method: string, path: string, { key, body }: { key?: Key; body?: unknown } = {}) {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (key) h.authorization = `Bearer ${key.secret}`;
  if (method !== "GET") h["idempotency-key"] = `rg-t2-${Date.now()}-${seq++}`;
  return new Request(`${BASE}${path}`, { method, headers: h, body: method === "GET" ? undefined : JSON.stringify(body) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (r: Response) => (await r.json()) as any;

/** A test game with Steam achievements (ACH_A, ACH_B and a hidden ACH_HIDDEN) and a PSN one. */
async function makeGame() {
  const slug = `${PREFIX}${Date.now()}-${seq++}`;
  const game = await prisma.game.create({
    data: {
      slug,
      name: `Jogo ${slug}`,
      platforms: ["PC"],
      achievementCount: 3,
      achievements: {
        create: [
          { platform: "steam", apiName: "ACH_A", name: "A", namePt: "Alfa" },
          { platform: "steam", apiName: "ACH_B", name: "B", namePt: "Beta" },
          { platform: "steam", apiName: "ACH_HIDDEN", name: "H", description: "Secret", namePt: "Oculta", descriptionPt: "Segredo", hidden: true },
          { platform: "psn", apiName: "PSN_1", name: "P" },
        ],
      },
    },
    select: { id: true, slug: true },
  });
  return game;
}

type ItemSpec = { key: string; achievement?: string; missable?: boolean; kind?: string };
const item = (spec: ItemSpec) => {
  const base = { ...fixture.chapters[0].steps[0].items[0] };
  delete base.achievement;
  return {
    ...base,
    key: spec.key,
    name: `Item ${spec.key}`,
    kind: spec.kind ?? (spec.achievement ? "achievement" : "collectible"),
    missable: spec.missable ?? false,
    ...(spec.achievement ? { achievement: spec.achievement } : {}),
  };
};

/** Walkthrough with one chapter (phaseKey fase-1) and two steps. */
function walkthrough(step0: ItemSpec[], step1: ItemSpec[]) {
  const body = fixture.chapters[0].steps[0].body;
  return {
    ...fixture,
    extraFacts: { ...fixture.extraFacts, hardest: null },
    chapters: [
      {
        ...fixture.chapters[0],
        key: "cap-1",
        phaseKey: "fase-1",
        steps: [
          { key: "p-1", body, items: step0.map(item) },
          { key: "p-2", body, items: step1.map(item) },
        ],
      },
    ],
  };
}

const FULL = (): [ItemSpec[], ItemSpec[]] => [
  [{ key: "i-1" }, { key: "i-2", achievement: "ACH_A" }],
  [{ key: "i-3", achievement: "ACH_B", missable: true }, { key: "i-4", achievement: "ACH_HIDDEN" }],
];

function payload(slug: string, wt: unknown, extra: Record<string, unknown> = {}) {
  return {
    game: { slug },
    format: 2,
    version: "v1.0",
    facts: { difficulty: 5, hoursMin: 1, hoursMax: 2, playthroughs: "1", missables: 1, online: 0 },
    steps: [{ key: "fase-1", title: "Tudo", hours: "1 h", body: [{ type: "paragraph", text: "Siga o roteiro." }], achievements: [] }],
    walkthrough: wt,
    report: { sourcesRead: [{ name: "PowerPyx", url: "https://www.powerpyx.com/", ok: true }], divergences: [], singleSource: [] },
    ...extra,
  };
}

async function createV2(key: Key = keys.robot, extra: Record<string, unknown> = {}) {
  const game = await makeGame();
  const response = await guides.POST(call("POST", "/api/v1/guides", { key, body: payload(game.slug, walkthrough(...FULL()), extra) }));
  return { game, response, body: await json(response) };
}

beforeAll(async () => {
  keys.robot = await createApiKey({ name: "rg-t2 robo", scopes: ["guides:write"] });
  keys.publisher = await createApiKey({ name: "rg-t2 editor", scopes: ["guides:write", "publish"] });
  keys.reader = await createApiKey({ name: "rg-t2 leitor", scopes: ["media:write"] });
  editorId = (await prisma.user.create({ data: { handle: `${PREFIX}editor`, displayName: "Editor" } })).id;
});

async function cleanup() {
  const ids = Object.values(keys).map((k) => k.id);
  await prisma.guide.deleteMany({ where: { botKeyId: { in: ids } } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.apiKey.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { handle: `${PREFIX}editor` } });
}
afterAll(cleanup);
beforeEach(() => {
  resetRateLimits();
  revalidateTag.mockClear();
});

describe("POST /api/v1/guides, format 2", () => {
  it("POST formato 2 válido cria guia em review com walkthrough e steps por fase", async () => {
    const { response, body } = await createV2();
    expect(response.status).toBe(201);
    expect(body).toMatchObject({ status: "review", revision: 1 });
    const guide = await prisma.guide.findUniqueOrThrow({
      where: { id: body.id },
      include: { steps: { orderBy: { order: "asc" } }, versions: true },
    });
    expect(guide).toMatchObject({ format: 2, status: "review", compat: "steam_only", edition: null, source: "bot" });
    expect((guide.walkthrough as any).chapters[0].steps[1].items[1].achievement).toBe("ACH_HIDDEN");
    expect(guide.steps.map((s) => s.key)).toEqual(["fase-1"]);
    expect(guide.report).toMatchObject({ sourcesRead: [{ name: "PowerPyx" }] });
    expect(guide.versions[0].snapshot).toMatchObject({ format: 2, walkthrough: { compat: "steam_only" } });
  });

  it("POST formato 2 sem uma conquista oculta → 422 /walkthrough citando o apiName", async () => {
    const game = await makeGame();
    const [s0, s1] = FULL();
    const wt = walkthrough(s0, s1.filter((i) => i.achievement !== "ACH_HIDDEN"));
    const response = await guides.POST(call("POST", "/api/v1/guides", { key: keys.robot, body: payload(game.slug, wt) }));
    expect(response.status).toBe(422);
    const issues = (await json(response)).error.issues as { path: string; message: string }[];
    expect(issues).toEqual([{ path: "/walkthrough", message: expect.stringContaining("ACH_HIDDEN") }]);
    expect(await prisma.guide.count({ where: { gameId: game.id } })).toBe(0);
  });

  it("item.achievement inexistente → 422 /walkthrough/chapters/0/steps/1/items/0/achievement", async () => {
    const game = await makeGame();
    const [s0, s1] = FULL();
    s1[0] = { ...s1[0], achievement: "ACH_NOPE" };
    const response = await guides.POST(call("POST", "/api/v1/guides", { key: keys.robot, body: payload(game.slug, walkthrough(s0, s1)) }));
    expect(response.status).toBe(422);
    const issues = (await json(response)).error.issues as { path: string }[];
    expect(issues.map((i) => i.path)).toContain("/walkthrough/chapters/0/steps/1/items/0/achievement");
  });

  it("a PSN apiName is not a Steam achievement", async () => {
    const game = await makeGame();
    const [s0, s1] = FULL();
    s0.push({ key: "i-9", achievement: "PSN_1" });
    const response = await guides.POST(call("POST", "/api/v1/guides", { key: keys.robot, body: payload(game.slug, walkthrough(s0, s1)) }));
    expect(response.status).toBe(422);
    expect(((await json(response)).error.issues as { path: string }[]).map((i) => i.path)).toContain(
      "/walkthrough/chapters/0/steps/0/items/2/achievement",
    );
  });

  it("facts.missables must equal the missable achievement items; phaseKey and step keys are checked", async () => {
    const game = await makeGame();
    const wt = walkthrough(...FULL());
    const wrong = payload(game.slug, wt, { facts: { difficulty: 5, hoursMin: 1, hoursMax: 2, playthroughs: "1", missables: 4, online: 0 } });
    const r1 = await guides.POST(call("POST", "/api/v1/guides", { key: keys.robot, body: wrong }));
    expect(r1.status).toBe(422);
    expect(((await json(r1)).error.issues as { path: string }[]).map((i) => i.path)).toContain("/facts/missables");

    const noKey = payload(game.slug, wt, { steps: [{ title: "Tudo", hours: "1 h", body: [{ type: "paragraph", text: "x" }], achievements: [] }] });
    const r2 = await guides.POST(call("POST", "/api/v1/guides", { key: keys.robot, body: noKey }));
    expect(r2.status).toBe(422);
    expect(((await json(r2)).error.issues as { path: string }[]).map((i) => i.path)).toContain("/walkthrough/chapters/0/phaseKey");
  });

  describe("scope psn (guia pela lista da PSN, R22)", () => {
    /** ACH_B and ACH_HIDDEN are not on the PSN list: steamOnly, no item. */
    const psnWalk = (steamOnly: string[]) => ({
      ...walkthrough([{ key: "i-1" }, { key: "i-2", achievement: "ACH_A" }], [{ key: "i-3" }]),
      scope: "psn",
      psnList: { total: 2, names: ["A", "Platinum"] },
      steamOnly,
    });
    const noMissables = { facts: { difficulty: 5, hoursMin: 1, hoursMax: 2, playthroughs: "1", missables: 0, online: 0 } };

    it("aceita quando toda conquista Steam sem item está em steamOnly", async () => {
      const game = await makeGame();
      const body = payload(game.slug, psnWalk(["ACH_B", "ACH_HIDDEN"]), noMissables);
      const response = await guides.POST(call("POST", "/api/v1/guides", { key: keys.robot, body }));
      expect(response.status).toBe(201);
      const guide = await prisma.guide.findUniqueOrThrow({ where: { id: (await json(response)).id } });
      expect(guide.status).toBe("review");
      expect(guide.walkthrough).toMatchObject({ scope: "psn", psnList: { total: 2 }, steamOnly: ["ACH_B", "ACH_HIDDEN"] });
    });

    it("recusa quando uma conquista Steam fica sem item e fora de steamOnly", async () => {
      const game = await makeGame();
      const body = payload(game.slug, psnWalk(["ACH_B"]), noMissables);
      const response = await guides.POST(call("POST", "/api/v1/guides", { key: keys.robot, body }));
      expect(response.status).toBe(422);
      const issues = (await json(response)).error.issues as { path: string; message: string }[];
      expect(issues).toEqual([{ path: "/walkthrough", message: expect.stringContaining("ACH_HIDDEN") }]);
    });

    it("steamOnly só aceita conquistas Steam do jogo, e sem item", async () => {
      const game = await makeGame();
      const body = payload(game.slug, psnWalk(["ACH_B", "ACH_HIDDEN", "PSN_1", "ACH_A"]), noMissables);
      const response = await guides.POST(call("POST", "/api/v1/guides", { key: keys.robot, body }));
      expect(response.status).toBe(422);
      const paths = ((await json(response)).error.issues as { path: string }[]).map((i) => i.path);
      expect(paths).toEqual(["/walkthrough/steamOnly/2", "/walkthrough/steamOnly/3"]);
    });
  });

  it("a steps PATCH on a format-2 guide needs keys", async () => {
    const { body } = await createV2();
    const steps = [{ title: "Tudo", hours: "1 h", body: [{ type: "paragraph", text: "x" }], achievements: [] }];
    const response = await guideById.PATCH(call("PATCH", `/api/v1/guides/${body.id}`, { key: keys.robot, body: { steps } }), params(body.id));
    expect(response.status).toBe(422);
    expect(((await json(response)).error.issues as { path: string }[]).map((i) => i.path)).toContain("/steps/0/key");
  });
});

describe("PATCH of a published format-2 guide", () => {
  async function publishedGuide() {
    const { game, body } = await createV2();
    await setGuideStatus({ id: body.id, status: "published" }, editorId);
    return { game, id: body.id as string };
  }

  it("PATCH em guia publicado cria pendente e não altera o guia", async () => {
    const { id } = await publishedGuide();
    const before = await prisma.guide.findUniqueOrThrow({ where: { id } });
    const versionsBefore = await prisma.guideVersion.count({ where: { guideId: id } });
    const [s0, s1] = FULL();
    const changed = walkthrough([...s0, { key: "i-new" }], s1);
    const response = await guideById.PATCH(call("PATCH", `/api/v1/guides/${id}`, { key: keys.robot, body: { walkthrough: changed } }), params(id));
    expect(response.status).toBe(202);
    const body = await json(response);
    expect(body).toMatchObject({ id, status: "pending_review", pendingId: expect.any(String) });
    const after = await prisma.guide.findUniqueOrThrow({ where: { id } });
    expect(after.walkthrough).toEqual(before.walkthrough);
    expect(after.status).toBe("published");
    expect(await prisma.guideVersion.count({ where: { guideId: id } })).toBe(versionsBefore);
    expect(await prisma.guidePendingUpdate.count({ where: { guideId: id } })).toBe(1);
  });

  it("a walkthrough-only PATCH is checked against the stored steps (phaseKey) and coverage", async () => {
    const { id } = await publishedGuide();
    const wt = walkthrough(...FULL());
    (wt.chapters[0] as any).phaseKey = "fase-que-nao-existe";
    const r1 = await guideById.PATCH(call("PATCH", `/api/v1/guides/${id}`, { key: keys.robot, body: { walkthrough: wt } }), params(id));
    expect(r1.status).toBe(422);
    expect(((await json(r1)).error.issues as { path: string }[]).map((i) => i.path)).toContain("/walkthrough/chapters/0/phaseKey");

    const [s0, s1] = FULL();
    const r2 = await guideById.PATCH(
      call("PATCH", `/api/v1/guides/${id}`, { key: keys.robot, body: { walkthrough: walkthrough(s0, s1.slice(0, 1)) } }),
      params(id),
    );
    expect(r2.status).toBe(422);
    expect(await prisma.guidePendingUpdate.count({ where: { guideId: id } })).toBe(0);
  });

  it("a steps patch that cannot apply is refused with 422 /steps, not queued", async () => {
    // A published format-1 guide with one keyless step.
    const game = await makeGame();
    const classic = { game: { slug: game.slug }, version: "v1.0", facts: payload(game.slug, {}).facts, steps: [{ title: "T", hours: "1 h", body: [{ type: "paragraph", text: "x" }], achievements: [] }] };
    const created = await json(await guides.POST(call("POST", "/api/v1/guides", { key: keys.robot, body: classic })));
    await setGuideStatus({ id: created.id, status: "published" }, editorId);
    const id = created.id as string;
    const step = (key: string) => ({ key, title: "T", hours: "1 h", body: [{ type: "paragraph", text: "x" }], achievements: [] });
    // Stored: one step "fase-1". Two keyless steps change the count.
    const keyless = [{ ...step("a"), key: undefined }, { ...step("b"), key: undefined }];
    const response = await guideById.PATCH(call("PATCH", `/api/v1/guides/${id}`, { key: keys.robot, body: { steps: keyless } }), params(id));
    expect(response.status).toBe(422);
    expect(((await json(response)).error.issues as { path: string }[]).map((i) => i.path)).toEqual(["/steps"]);
    expect(await prisma.guidePendingUpdate.count({ where: { guideId: id } })).toBe(0);
  });

  it("applyPendingUpdate aplica e salva GuideVersion", async () => {
    const { id, game } = await publishedGuide();
    const [s0, s1] = FULL();
    const changed = walkthrough([...s0, { key: "i-new" }], s1);
    const { pendingId } = await json(
      await guideById.PATCH(call("PATCH", `/api/v1/guides/${id}`, { key: keys.robot, body: { walkthrough: changed, version: "v1.1" } }), params(id)),
    );
    const revisionBefore = (await prisma.guideVersion.aggregate({ where: { guideId: id }, _max: { version: true } }))._max.version as number;
    const applied = await applyPendingUpdate(pendingId, editorId);
    const guide = await prisma.guide.findUniqueOrThrow({ where: { id } });
    expect(guide.status).toBe("published");
    expect(guide.version).toBe("v1.1");
    expect((guide.walkthrough as any).chapters[0].steps[0].items).toHaveLength(3);
    const last = await prisma.guideVersion.findFirstOrThrow({ where: { guideId: id }, orderBy: { version: "desc" } });
    expect(last).toMatchObject({ version: revisionBefore + 1, authorId: editorId });
    expect(await prisma.guidePendingUpdate.count({ where: { guideId: id } })).toBe(0);
    expect(applied.gameSlug).toBe(game.slug);
  });

  it("discardPendingUpdate removes it without touching the guide", async () => {
    const { id } = await publishedGuide();
    const before = await prisma.guide.findUniqueOrThrow({ where: { id } });
    const { pendingId } = await json(
      await guideById.PATCH(call("PATCH", `/api/v1/guides/${id}`, { key: keys.robot, body: { version: "v9.9" } }), params(id)),
    );
    await discardPendingUpdate(pendingId);
    expect(await prisma.guidePendingUpdate.count({ where: { guideId: id } })).toBe(0);
    expect((await prisma.guide.findUniqueOrThrow({ where: { id } })).version).toBe(before.version);
  });

  it("itens com a mesma chave mantêm GuideItemProgress após PATCH aprovado; item removido perde a marca", async () => {
    const { id } = await publishedGuide();
    const reader = await prisma.user.create({ data: { handle: `${PREFIX}leitor${seq++}`, displayName: "Leitor" } });
    try {
      await prisma.guideItemProgress.createMany({
        data: ["i-1", "i-2", "i-4"].map((itemKey) => ({ userId: reader.id, guideId: id, itemKey })),
      });
      const [s0, s1] = FULL();
      // i-1 stays; i-2 is dropped from step 0 (its achievement is still covered elsewhere); i-4 stays.
      const next = walkthrough([{ key: "i-1" }, { key: "i-5", achievement: "ACH_A" }], s1);
      const { pendingId } = await json(
        await guideById.PATCH(call("PATCH", `/api/v1/guides/${id}`, { key: keys.robot, body: { walkthrough: next } }), params(id)),
      );
      expect(s0.length).toBe(2);
      await applyPendingUpdate(pendingId, editorId);
      const rows = await prisma.guideItemProgress.findMany({ where: { userId: reader.id, guideId: id }, orderBy: { itemKey: "asc" } });
      expect(rows.map((r) => r.itemKey)).toEqual(["i-1", "i-4"]);
    } finally {
      await prisma.user.delete({ where: { id: reader.id } });
    }
  });

  it("a key with publish updates a published guide directly (200)", async () => {
    const { game, response, body } = await createV2(keys.publisher, { status: "published" });
    expect(response.status).toBe(201);
    const patched = await guideById.PATCH(call("PATCH", `/api/v1/guides/${body.id}`, { key: keys.publisher, body: { version: "v2.0" } }), params(body.id));
    expect(patched.status).toBe(200);
    expect((await prisma.guide.findUniqueOrThrow({ where: { id: body.id } })).version).toBe("v2.0");
    expect(game.slug).toBeTruthy();
  });
});

describe("edition", () => {
  it("edition é atribuída na primeira publicação e não muda depois", async () => {
    const a = await createV2();
    expect((await prisma.guide.findUniqueOrThrow({ where: { id: a.body.id } })).edition).toBeNull();
    await setGuideStatus({ id: a.body.id, status: "published" }, editorId);
    const first = (await prisma.guide.findUniqueOrThrow({ where: { id: a.body.id } })).edition;
    expect(first).toBeGreaterThan(0);

    await setGuideStatus({ id: a.body.id, status: "draft" }, editorId);
    await setGuideStatus({ id: a.body.id, status: "published" }, editorId);
    expect((await prisma.guide.findUniqueOrThrow({ where: { id: a.body.id } })).edition).toBe(first);

    const b = await createV2();
    await setGuideStatus({ id: b.body.id, status: "published" }, editorId);
    expect((await prisma.guide.findUniqueOrThrow({ where: { id: b.body.id } })).edition).toBe((first as number) + 1);
  });
});

describe("GET /api/v1/games/{slug}/dossie", () => {
  const get = (slug: string, query: string, key: Key) =>
    dossier.GET(call("GET", `/api/v1/games/${slug}/dossie${query}`, { key }), { params: Promise.resolve({ slug }) });

  it("dossie all=1 inclui ocultas", async () => {
    const game = await makeGame();
    const plain = await json(await get(game.slug, "", keys.robot));
    expect(plain.achievements.map((a: any) => a.apiName)).not.toContain("ACH_HIDDEN");
    expect(plain.achievements[0]).not.toHaveProperty("hidden");

    const response = await get(game.slug, "?all=1", keys.robot);
    expect(response.status).toBe(200);
    const full = await json(response);
    const hidden = full.achievements.find((a: any) => a.apiName === "ACH_HIDDEN");
    expect(hidden).toMatchObject({ hidden: true, namePt: "Oculta", descriptionPt: "Segredo", platform: "steam" });
    expect(full.achievements.find((a: any) => a.apiName === "ACH_A")).toMatchObject({ hidden: false, namePt: "Alfa" });
  });

  it("dossie all=1 sem guides:write → 403", async () => {
    const game = await makeGame();
    expect((await get(game.slug, "?all=1", keys.reader)).status).toBe(403);
    expect((await get(game.slug, "", keys.reader)).status).toBe(200);
  });
});
