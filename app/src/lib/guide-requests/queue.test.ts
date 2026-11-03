import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SteamApi } from "@/lib/integrations";

const WITH_ACH = 96100001;
const NO_ACH = 96100002;
/** Has achievements, but Steam knows it only by appid (a placeholder catalog entry, no dossier). */
const NAMELESS = 96100003;
const APPS = [WITH_ACH, NO_ACH, NAMELESS];
const HOUR = 3_600_000;
const DAY = 86_400_000;

const steamState = vi.hoisted(() => ({ api: null as unknown as SteamApi }));
vi.mock("@/lib/integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations")>();
  const { createSteamFixture } = await import("@/lib/integrations/steam/fixture");
  const fixture = createSteamFixture();
  steamState.api = {
    ...fixture,
    async getSchemaForGame(appId, lang) {
      if (appId === WITH_ACH || appId === NAMELESS) {
        return [
          lang === "brazilian"
            ? { apiName: "ACH_A", name: "Primeira vitória", description: "Vença uma vez.", hidden: false }
            : { apiName: "ACH_A", name: "First win", description: "Win once.", hidden: false },
        ];
      }
      return fixture.getSchemaForGame(appId, lang);
    },
  };
  return {
    ...actual,
    getSteam: () => steamState.api,
    getIgdb: () => ({ findBySteamAppId: async () => null }),
    getRawg: () => ({ findBySteamAppId: async () => null }),
    getSgdb: () => ({ getArt: async () => ({}) }),
  };
});

const { prisma } = await import("@/lib/db");
const { createApiKey } = await import("@/lib/api/keys");
const queue = await import("./queue");
const next = await import("@/app/api/v1/guide-requests/next/route");
const patch = await import("@/app/api/v1/guide-requests/[id]/route");

const T0 = new Date("2026-11-03T12:00:00.000Z");

async function seed(
  over: Partial<{ steamAppId: number; status: string; priority: number; createdAt: Date; nextAttemptAt: Date | null }> = {},
) {
  return prisma.guideRequest.create({ data: { steamAppId: WITH_ACH, status: "queued", ...over } });
}

const nextRequest = (secret: string) =>
  new Request("http://localhost:3000/api/v1/guide-requests/next", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });

beforeAll(async () => {
  // A named catalog entry: syncGame keeps the name (IGDB is off here), so the game is not a stub.
  await prisma.game.upsert({
    where: { steamAppId: WITH_ACH },
    create: { steamAppId: WITH_ACH, slug: "t3-pedidos-jogo", name: "Jogo dos Pedidos", platforms: ["PC"], achievementCount: 1 },
    update: { name: "Jogo dos Pedidos" },
  });
});

beforeEach(async () => {
  // The test database is private to this suite run: the claim order depends on the whole table.
  await prisma.guideRequest.deleteMany();
});

afterAll(async () => {
  await prisma.guideRequest.deleteMany();
  await prisma.game.deleteMany({ where: { steamAppId: { in: APPS } } });
  await prisma.$disconnect();
});

describe("guide request queue", () => {
  it("pedido de jogo sem conquistas é recusado", async () => {
    await expect(queue.createGuideRequest({ steamAppId: NO_ACH, requestedById: null })).rejects.toThrow(
      "sem conquistas na Steam",
    );
    expect(await prisma.guideRequest.count()).toBe(0);
  });

  it("segundo pedido aberto do mesmo jogo é recusado", async () => {
    const first = await queue.createGuideRequest({ steamAppId: WITH_ACH, requestedById: null });
    expect(first.status).toBe("queued");
    expect(first.gameId).not.toBeNull();
    await expect(queue.createGuideRequest({ steamAppId: WITH_ACH, requestedById: null })).rejects.toThrow("aberto");
    // Even an update request: only one open request per game.
    await expect(queue.createGuideRequest({ steamAppId: WITH_ACH, requestedById: null, update: true })).rejects.toThrow(
      "aberto",
    );
  });

  it("jogo que a Steam só conhece pelo appid (sem dossiê) é recusado", async () => {
    await expect(queue.createGuideRequest({ steamAppId: NAMELESS, requestedById: null })).rejects.toThrow(
      "ainda não tem nome",
    );
    expect(await prisma.guideRequest.count()).toBe(0);
  });

  it("atualização só para guia escrito pelo robô", async () => {
    const { syncGame } = await import("@/lib/sync/catalog");
    const game = (await syncGame(WITH_ACH))!;
    const guide = await prisma.guide.create({
      data: { gameId: game.id, status: "published", version: "v1", difficulty: 1, hoursMin: 1, hoursMax: 2, playthroughs: "1", missables: 0, online: 0, source: "editorial" },
    });
    try {
      await expect(queue.createGuideRequest({ steamAppId: WITH_ACH, requestedById: null, update: true })).rejects.toThrow(
        "não foi escrito pelo robô",
      );
      expect(await prisma.guideRequest.count()).toBe(0);
    } finally {
      await prisma.guide.delete({ where: { id: guide.id } });
    }
  });

  it("jogo com guia só aceita pedido com update", async () => {
    const { syncGame } = await import("@/lib/sync/catalog");
    const game = (await syncGame(WITH_ACH))!;
    const key = await createApiKey({ name: "t3 autor do guia", scopes: ["guides:write"] });
    const guide = await prisma.guide.create({
      data: {
        gameId: game.id,
        source: "bot",
        botKeyId: key.id,
        status: "published",
        version: "v1",
        difficulty: 1,
        hoursMin: 1,
        hoursMax: 2,
        playthroughs: "1",
        missables: 0,
        online: 0,
      },
    });
    await expect(queue.createGuideRequest({ steamAppId: WITH_ACH, requestedById: null })).rejects.toThrow("já tem guia");
    const request = await queue.createGuideRequest({ steamAppId: WITH_ACH, requestedById: null, update: true });
    expect(request.guideId).toBe(guide.id);
    await prisma.guide.delete({ where: { id: guide.id } });
    await prisma.apiKey.delete({ where: { id: key.id } });
  });

  it("claimNextRequest respeita prioridade e depois a ordem de chegada", async () => {
    const old = await seed({ createdAt: new Date(T0.getTime() - 3 * DAY) });
    const newer = await seed({ createdAt: new Date(T0.getTime() - 1 * DAY) });
    const urgent = await seed({ createdAt: new Date(T0.getTime() - 2 * DAY), priority: 1 });

    const order: (string | null)[] = [];
    for (let i = 0; i < 4; i++) order.push((await queue.claimNextRequest(T0))?.id ?? null);
    expect(order).toEqual([urgent.id, old.id, newer.id, null]);

    const claimed = await prisma.guideRequest.findUniqueOrThrow({ where: { id: urgent.id } });
    expect(claimed).toMatchObject({ status: "researching", attempts: 1 });
  });

  it("claim simultâneo devolve o pedido uma vez só", async () => {
    await seed();
    const [a, b] = await Promise.all([queue.claimNextRequest(T0), queue.claimNextRequest(T0)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("pedido preso em researching/writing há mais de 4 h volta a ser pego (nova tentativa)", async () => {
    const stuck = await seed({ status: "writing" });
    await prisma.guideRequest.update({ where: { id: stuck.id }, data: { attempts: 1, updatedAt: new Date(T0.getTime() - 4 * HOUR - 1000) } });
    const fresh = await seed({ status: "researching" });
    await prisma.guideRequest.update({ where: { id: fresh.id }, data: { attempts: 1, updatedAt: new Date(T0.getTime() - 3 * HOUR) } });

    const claimed = await queue.claimNextRequest(T0);
    expect(claimed).toMatchObject({ id: stuck.id, status: "researching", attempts: 2 });
    expect(await queue.claimNextRequest(T0)).toBeNull();
  });

  it("retryNow aceita researching/writing parado há mais de 4 h, e só então", async () => {
    const stuck = await seed({ status: "researching" });
    await prisma.guideRequest.update({ where: { id: stuck.id }, data: { updatedAt: new Date(T0.getTime() - 5 * HOUR) } });
    const working = await seed({ status: "writing", steamAppId: NO_ACH });
    await prisma.guideRequest.update({ where: { id: working.id }, data: { updatedAt: new Date(T0.getTime() - HOUR) } });

    expect(queue.canRetry({ status: "writing", updatedAt: new Date(T0.getTime() - HOUR) }, T0)).toBe(false);
    expect(queue.canRetry({ status: "researching", updatedAt: new Date(T0.getTime() - 5 * HOUR) }, T0)).toBe(true);
    expect(await queue.retryNow(working.id, T0)).toBeNull();
    expect((await queue.retryNow(stuck.id, T0))?.status).toBe("queued");
  });

  it("waiting_sources volta em 3 dias e falha após 30", async () => {
    const request = await seed();
    await queue.claimNextRequest(T0);

    const waiting = await queue.reportRequest(request.id, { status: "waiting_sources", reason: "só uma fonte" }, T0);
    expect(waiting.ok && waiting.request).toMatchObject({ status: "waiting_sources", firstWaitingAt: T0 });
    expect(waiting.ok && waiting.request.nextAttemptAt).toEqual(new Date(T0.getTime() + 3 * DAY));

    expect(await queue.claimNextRequest(new Date(T0.getTime() + 3 * DAY - 1000))).toBeNull();
    const again = await queue.claimNextRequest(new Date(T0.getTime() + 3 * DAY));
    expect(again).toMatchObject({ id: request.id, status: "researching", attempts: 2 });

    // Another miss at day 6 keeps waiting and keeps the first date.
    const second = await queue.reportRequest(request.id, { status: "waiting_sources" }, new Date(T0.getTime() + 6 * DAY));
    expect(second.ok && second.request.firstWaitingAt).toEqual(T0);
    expect(second.ok && second.request.status).toBe("waiting_sources");

    const late = await queue.reportRequest(request.id, { status: "waiting_sources" }, new Date(T0.getTime() + 31 * DAY));
    expect(late.ok && late.request).toMatchObject({ status: "failed", reason: "fontes insuficientes após 30 dias" });
    expect(late.ok && late.request.nextAttemptAt).toBeNull();
  });

  it("retryNow, cancelRequest e bumpPriority", async () => {
    const request = await seed({ status: "failed" });
    expect((await queue.retryNow(request.id))?.status).toBe("queued");
    expect((await queue.bumpPriority(request.id, 1))?.priority).toBe(1);
    expect((await queue.bumpPriority(request.id, -1))?.priority).toBe(0);
    expect((await queue.cancelRequest(request.id))?.status).toBe("cancelled");
    expect(await queue.cancelRequest(request.id)).toBeNull();
    const refused = await queue.reportRequest(request.id, { status: "writing" }, T0);
    expect(refused).toMatchObject({ ok: false, code: "closed" });
  });

  it("syncGame grava namePt e descriptionPt", async () => {
    const { syncGame } = await import("@/lib/sync/catalog");
    const game = await syncGame(WITH_ACH);
    const row = await prisma.achievement.findFirstOrThrow({ where: { gameId: game!.id, apiName: "ACH_A" } });
    expect(row).toMatchObject({
      name: "First win",
      description: "Win once.",
      namePt: "Primeira vitória",
      descriptionPt: "Vença uma vez.",
    });
  });

  it("route next sem guides:write → 403", async () => {
    const key = await createApiKey({ name: "t3 sem escopo", scopes: ["media:write"] });
    try {
      expect((await next.POST(nextRequest(key.secret))).status).toBe(403);
    } finally {
      await prisma.apiKey.deleteMany({ where: { id: key.id } });
    }
  });

  it("route next devolve o pedido com o slug do jogo, ou 204", async () => {
    const key = await createApiKey({ name: "t3 guias", scopes: ["guides:write"] });
    try {
      expect((await next.POST(nextRequest(key.secret))).status).toBe(204);
      const request = await queue.createGuideRequest({ steamAppId: WITH_ACH, requestedById: null });
      const response = await next.POST(nextRequest(key.secret));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { request: Record<string, unknown> };
      const game = await prisma.game.findUniqueOrThrow({ where: { steamAppId: WITH_ACH } });
      expect(body.request).toEqual({ id: request.id, steamAppId: WITH_ACH, gameSlug: game.slug, attempts: 1 });
    } finally {
      await prisma.apiKey.deleteMany({ where: { id: key.id } });
    }
  });

  it("PATCH reporta o pedido, com Idempotency-Key", async () => {
    const key = await createApiKey({ name: "t3 patch", scopes: ["guides:write"] });
    try {
      const request = await seed({ status: "researching" });
      const send = (body: unknown, idem: string) =>
        patch.PATCH(
          new Request(`http://localhost:3000/api/v1/guide-requests/${request.id}`, {
            method: "PATCH",
            headers: { authorization: `Bearer ${key.secret}`, "content-type": "application/json", "idempotency-key": idem },
            body: JSON.stringify(body),
          }),
          { params: Promise.resolve({ id: request.id }) },
        );
      const ok = await send({ status: "waiting_sources", reason: "só uma fonte", report: { sources: 1 } }, "t3-a");
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ id: request.id, status: "waiting_sources" });
      expect((await send({ status: "published" }, "t3-b")).status).toBe(422);
      const row = await prisma.guideRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(row).toMatchObject({ status: "waiting_sources", reason: "só uma fonte", report: { sources: 1 } });
    } finally {
      await prisma.ingestionLog.deleteMany({ where: { keyId: key.id } });
      await prisma.apiKey.deleteMany({ where: { id: key.id } });
    }
  });
});
