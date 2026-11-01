import { describe, expect, it, vi } from "vitest";
import type { Ai, StructuredOpts } from "../src/ai/client.js";
import { loadStyle, type Draft } from "../src/ai/writer.js";
import { openDb, type Db } from "../src/db.js";
import {
  PAUTA_FORMATS,
  PautaRejectedError,
  chooseFormat,
  gatherPautaSources,
  loadFamousGames,
  loadPautaStyle,
  pautaKey,
  pickPautaGame,
  recordPauta,
  writePauta,
  type FamousGame,
  type PautaFormat,
  type PautaSources,
} from "../src/pautas.js";
import { slugify, type Dossier, type Tralked } from "../src/tralked.js";

// America/Sao_Paulo is UTC-3 all year (no DST since 2019).
const local = (wall: string) => new Date(`${wall}:00-03:00`);
const NOW = local("2026-10-31T10:00");
const UA = "TralkedBot/1.0 (+https://tralked.com)";

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

function dossierOf(
  name: string,
  opts: { achievements?: number; withPct?: number; steamAppId?: number | null; slug?: string } = {},
): Dossier {
  const total = opts.achievements ?? 20;
  const withPct = Math.min(opts.withPct ?? total, total);
  return {
    game: {
      slug: opts.slug ?? slugify(name),
      name,
      steamAppId: opts.steamAppId === undefined ? 367520 : opts.steamAppId,
      summary: `${name} é um jogo de ação.`,
      developer: "Team Cherry",
      publisher: "Team Cherry",
      releaseDate: "2017-02-24",
      platforms: ["PC", "NINTENDO"],
      criticScore: 87,
      timeToBeatCompleteMin: 3720,
      achievementCount: total,
    },
    tralked: { players: 12, avgPlaytimeMin: 2400, completedPlayers: 3 },
    achievements: Array.from({ length: total }, (_, i) => ({
      platform: "steam",
      apiName: `ACH_${i + 1}`,
      name: `Conquista ${i + 1}`,
      description: `Faça a coisa número ${i + 1}.`,
      globalPct: i < withPct ? 0.5 + i : null,
    })),
  };
}

const ENTRY: FamousGame = { name: "Hollow Knight", steamAppId: 367520, wiki: "https://wiki.test/wiki/Hollow_Knight" };

/** Sources with every format eligible unless overridden. */
function sources(over: Partial<PautaSources> = {}): PautaSources {
  return {
    entry: ENTRY,
    slug: "hollow-knight",
    name: "Hollow Knight",
    dossier: dossierOf("Hollow Knight"),
    steam: { url: "https://store.steampowered.com/app/367520/", text: "Explore cavernas. ".repeat(100) },
    wiki: [{ url: "https://wiki.test/wiki/Hollow_Knight", text: "Some achievements are missable, so check before the last boss." }],
    ...over,
  };
}

const short = { url: "https://store.steampowered.com/app/367520/", text: "Um jogo curto." };

// ---------------------------------------------------------------------------------------------
// chooseFormat
// ---------------------------------------------------------------------------------------------

describe("chooseFormat", () => {
  it("vale-o-100 needs at least 10 achievements", () => {
    const base = { steam: short, wiki: [] };
    expect(chooseFormat(sources({ ...base, dossier: dossierOf("Hollow Knight", { achievements: 10, withPct: 0 }) }), [], () => 0)).toBe("vale-o-100");
    expect(chooseFormat(sources({ ...base, dossier: dossierOf("Hollow Knight", { achievements: 9, withPct: 0 }) }), [], () => 0)).toBeNull();
  });

  it("mais-raras needs at least 5 achievements with a global percentage", () => {
    const base = { steam: short, wiki: [] };
    expect(chooseFormat(sources({ ...base, dossier: dossierOf("Hollow Knight", { achievements: 9, withPct: 5 }) }), [], () => 0)).toBe("mais-raras");
    expect(chooseFormat(sources({ ...base, dossier: dossierOf("Hollow Knight", { achievements: 9, withPct: 4 }) }), [], () => 0)).toBeNull();
  });

  it("perdiveis needs a wiki saying perd/missable/miss near achievement/conquista", () => {
    const few = dossierOf("Hollow Knight", { achievements: 3, withPct: 0 });
    const wiki = (text: string) => sources({ dossier: few, steam: short, wiki: [{ url: "https://wiki.test/x", text }] });
    expect(chooseFormat(wiki("Some achievements are missable after the ending."), [], () => 0)).toBe("perdiveis");
    expect(chooseFormat(wiki("Atenção: há conquistas perdíveis no capítulo 3."), [], () => 0)).toBe("perdiveis");
    expect(chooseFormat(wiki("If you miss the merchant, the Achievement is gone."), [], () => 0)).toBe("perdiveis");
    expect(chooseFormat(wiki(`Do not miss the boss.${" filler".repeat(60)} One achievement for the ending.`), [], () => 0)).toBeNull();
    expect(chooseFormat(wiki("A lovely game about bugs."), [], () => 0)).toBeNull();
    // Steam marketing text is not a guide: it never makes a game "perdíveis".
    const steamOnly = sources({ dossier: few, steam: { ...short, text: "No missable achievements here!" }, wiki: [] });
    expect(chooseFormat(steamOnly, [], () => 0)).toBeNull();
  });

  it("iniciantes needs 1,500 characters of wiki or Steam text", () => {
    const few = dossierOf("Hollow Knight", { achievements: 3, withPct: 0 });
    const at = (n: number) => sources({ dossier: few, steam: { ...short, text: "a".repeat(n - 500) }, wiki: [{ url: "https://wiki.test/x", text: "b".repeat(500) }] });
    expect(chooseFormat(at(1500), [], () => 0)).toBe("iniciantes");
    expect(chooseFormat(at(1499), [], () => 0)).toBeNull();
  });

  it("returns null without the dossier, or without any Steam or wiki text", () => {
    expect(chooseFormat(sources({ dossier: null }), [], () => 0)).toBeNull();
    expect(chooseFormat(sources({ steam: null, wiki: [] }), [], () => 0)).toBeNull();
    expect(chooseFormat(sources({ steam: { ...short, text: "  " }, wiki: [{ url: "https://wiki.test/x", text: "" }] }), [], () => 0)).toBeNull();
  });

  it("prefers a format not used in the last 5 pautas, at random among the eligible otherwise", () => {
    const all = sources();
    const recent: PautaFormat[] = ["vale-o-100", "mais-raras", "perdiveis"];
    for (const r of [0, 0.4, 0.99]) expect(chooseFormat(all, recent, () => r)).toBe("iniciantes");
    // `recent` is most recent first and only the last 5 count: the 6th (older) use does not block.
    expect(chooseFormat(all, ["vale-o-100", "mais-raras", "perdiveis", "vale-o-100", "mais-raras", "iniciantes"], () => 0)).toBe("iniciantes");
    // Every eligible format used recently: any eligible one, chosen by `rand`.
    const picked = new Set([0, 0.3, 0.6, 0.99].map((r) => chooseFormat(all, [...PAUTA_FORMATS], () => r)));
    expect(picked).toEqual(new Set(PAUTA_FORMATS));
  });
});

// ---------------------------------------------------------------------------------------------
// pickPautaGame
// ---------------------------------------------------------------------------------------------

describe("pickPautaGame", () => {
  const LIST: FamousGame[] = [{ name: "Hades" }, { name: "Celeste" }, { name: "Terraria" }, { name: "Hollow Knight" }];
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

  function db(): Db {
    return openDb(":memory:");
  }

  it("never picks a game with a pauta in the last 60 days", () => {
    const d = db();
    recordPauta(d, { gameName: "Hades", gameSlug: "hades", format: "iniciantes", status: "published", mode: "live", storyDate: "2026-10-01" }, daysAgo(30));
    recordPauta(d, { gameName: "Celeste", gameSlug: "celeste", format: "vale-o-100", status: "published", mode: "backfill", storyDate: "2026-09-02" }, daysAgo(59));
    recordPauta(d, { gameName: "Terraria", gameSlug: "terraria", format: "vale-o-100", status: "published", mode: "backfill", storyDate: "2026-08-31" }, daysAgo(61));
    const picked = new Set([0, 0.2, 0.5, 0.7, 0.99].map((r) => pickPautaGame(d, LIST, NOW, () => r)?.name));
    expect(picked).toEqual(new Set(["Terraria", "Hollow Knight"]));
  });

  it("skips games missing from the catalog and games skipped for lack of material", () => {
    const d = db();
    recordPauta(d, { gameName: "Hades", gameSlug: null, format: null, status: "skipped", mode: "live", storyDate: "2026-10-20", error: "fora do catálogo" }, daysAgo(11));
    recordPauta(d, { gameName: "Celeste", gameSlug: "celeste", format: null, status: "skipped", mode: "live", storyDate: "2026-10-30", error: "sem material" }, daysAgo(1));
    const picked = new Set([0, 0.3, 0.6, 0.99].map((r) => pickPautaGame(d, LIST, NOW, () => r)?.name));
    expect(picked).toEqual(new Set(["Terraria", "Hollow Knight"]));
  });

  it("counts a backfill pauta dated within 60 days of `now`, either side", () => {
    const d = db();
    // Planned for a day 10 days after `now` (the backfill plans by story date): still too close.
    recordPauta(d, { gameName: "Hollow Knight", gameSlug: "hollow-knight", format: "mais-raras", status: "bf_planned", mode: "backfill", storyDate: "2026-11-10" }, NOW);
    for (const r of [0, 0.5, 0.99]) expect(pickPautaGame(d, [{ name: "Hollow Knight" }, { name: "Hades" }], NOW, () => r)?.name).toBe("Hades");
  });

  it("returns null when every game is blocked", () => {
    const d = db();
    for (const g of LIST) recordPauta(d, { gameName: g.name, gameSlug: slugify(g.name), format: "iniciantes", status: "published", mode: "live", storyDate: "2026-10-30" }, daysAgo(1));
    expect(pickPautaGame(d, LIST, NOW, () => 0.5)).toBeNull();
    expect(pickPautaGame(d, [], NOW, () => 0.5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// gatherPautaSources
// ---------------------------------------------------------------------------------------------

const STEAM_URL = "https://store.steampowered.com/api/appdetails?appids=367520&l=brazilian";

function steamJson(name = "Hollow Knight", about = "<h2>Desça</h2><p>Explore cavernas <b>sinuosas</b> e cidades antigas.</p>") {
  return JSON.stringify({ "367520": { success: true, data: { name, about_the_game: about } } });
}

function wikiPage(body: string, links = '<a href="/wiki/Achievements">Achievements</a>') {
  const paragraphs = [1, 2, 3, 4]
    .map((n) => `<p>${body} Parágrafo ${n} com bastante texto corrido sobre o jogo, as áreas, os chefes e os segredos do mapa.</p>`)
    .join("");
  return `<!DOCTYPE html><html><head><title>Hollow Knight</title></head><body><nav>${links}</nav><article><h1>Hollow Knight</h1>${paragraphs}</article></body></html>`;
}

function gatherHarness(over: { pages?: Record<string, Response | (() => Response)>; dossier?: Dossier | null; hit?: { slug: string; name: string } | null } = {}) {
  const pages: Record<string, Response | (() => Response)> = {
    [STEAM_URL]: () => new Response(steamJson(), { status: 200 }),
    "https://wiki.test/wiki/Hollow_Knight": () => new Response(wikiPage("Hollow Knight é um metroidvania."), { status: 200 }),
    "https://wiki.test/wiki/Achievements": () => new Response(wikiPage("Some achievements are missable."), { status: 200 }),
    ...over.pages,
  };
  const fetchFn = vi.fn(async (input: string, _init?: RequestInit) => {
    const page = pages[input];
    if (!page) return new Response("not found", { status: 404 });
    return typeof page === "function" ? page() : page;
  });
  const findGame = vi.fn(async (name: string) => (over.hit === undefined ? { slug: slugify(name), name } : over.hit));
  const dossier = vi.fn(async (slug: string) => (over.dossier === undefined ? dossierOf("Hollow Knight", { slug }) : over.dossier));
  const tralked = { findGame, dossier } as unknown as Tralked;
  return { fetchFn, findGame, dossier, deps: { tralked, fetchFn } };
}

describe("gatherPautaSources", () => {
  it("collects the dossier, the Steam text without HTML and the wiki pages (main and achievements), with the honest UA", async () => {
    const h = gatherHarness();
    const s = await gatherPautaSources(ENTRY, h.deps);
    expect(h.findGame).toHaveBeenCalledWith("Hollow Knight");
    expect(h.dossier).toHaveBeenCalledWith("hollow-knight");
    expect(s.slug).toBe("hollow-knight");
    expect(s.dossier?.game.name).toBe("Hollow Knight");
    expect(s.steam).toEqual({ url: "https://store.steampowered.com/app/367520/", text: "Desça Explore cavernas sinuosas e cidades antigas." });
    expect(s.wiki.map((w) => w.url)).toEqual(["https://wiki.test/wiki/Hollow_Knight", "https://wiki.test/wiki/Achievements"]);
    expect(s.wiki[0]!.text).toContain("metroidvania");
    expect(s.wiki[1]!.text).toContain("missable");
    for (const [, init] of h.fetchFn.mock.calls) expect((init?.headers as Record<string, string>)["User-Agent"]).toBe(UA);
  });

  it("treats a 403 or a challenge page as an unavailable source, never retrying around it", async () => {
    const challenge = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id="challenge-error-text">Enable JavaScript and cookies to continue</div><script>window._cf_chl_opt={}</script></body></html>';
    const blocked = gatherHarness({ pages: { "https://wiki.test/wiki/Hollow_Knight": () => new Response("forbidden", { status: 403 }) } });
    const s1 = await gatherPautaSources(ENTRY, blocked.deps);
    expect(s1.wiki).toEqual([]);
    expect(s1.steam?.text).toContain("cavernas");
    expect(blocked.fetchFn.mock.calls.filter(([url]) => url.startsWith("https://wiki.test/"))).toHaveLength(1);

    const challenged = gatherHarness({ pages: { "https://wiki.test/wiki/Hollow_Knight": () => new Response(challenge, { status: 200 }) } });
    const s2 = await gatherPautaSources(ENTRY, challenged.deps);
    expect(s2.wiki).toEqual([]);
    expect(challenged.fetchFn.mock.calls.filter(([url]) => url.startsWith("https://wiki.test/"))).toHaveLength(1);
  });

  it("drops a catalog hit that is another game, and fetches nothing else without a dossier", async () => {
    const other = gatherHarness({ hit: { slug: "hollow-knight-silksong", name: "Hollow Knight: Silksong" }, dossier: dossierOf("Hollow Knight: Silksong", { steamAppId: 1030300 }) });
    const s = await gatherPautaSources(ENTRY, other.deps);
    expect(s.dossier).toBeNull();
    expect(other.fetchFn).not.toHaveBeenCalled();

    const missing = gatherHarness({ dossier: null });
    const m = await gatherPautaSources(ENTRY, missing.deps);
    expect(m.dossier).toBeNull();
    expect(missing.fetchFn).not.toHaveBeenCalled();

    const none = gatherHarness({ hit: null });
    expect((await gatherPautaSources(ENTRY, none.deps)).dossier).toBeNull();
  });

  it("accepts a catalog hit under another name when the Steam app id matches, and a pinned slug", async () => {
    const renamed = gatherHarness({ hit: { slug: "hollow-knight-voidheart", name: "Hollow Knight: Voidheart Edition" }, dossier: dossierOf("Hollow Knight: Voidheart Edition") });
    expect((await gatherPautaSources(ENTRY, renamed.deps)).slug).toBe("hollow-knight-voidheart");

    const pinned = gatherHarness({ dossier: dossierOf("HK", { steamAppId: null }) });
    const s = await gatherPautaSources({ ...ENTRY, slug: "hk-pinned" }, pinned.deps);
    expect(pinned.findGame).not.toHaveBeenCalled();
    expect(pinned.dossier).toHaveBeenCalledWith("hk-pinned");
    expect(s.slug).toBe("hk-pinned");
  });

  it("drops Steam text that belongs to another game", async () => {
    const h = gatherHarness({
      dossier: dossierOf("Hollow Knight", { steamAppId: null }),
      pages: { [STEAM_URL]: () => new Response(steamJson("Some Other Game"), { status: 200 }) },
    });
    const s = await gatherPautaSources(ENTRY, h.deps);
    expect(s.steam).toBeNull();
    expect(s.wiki.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// writePauta
// ---------------------------------------------------------------------------------------------

const DRAFT: Draft = {
  title: "Título do modelo",
  subtitle: "Linha fina.",
  excerpt: "Resumo.",
  pontos: ["Um.", "Dois.", "Três."],
  corpo: [{ p: "Texto." }],
  noTralked: { casual: "Leva umas 62 horas.", cacador: "Tem 20 conquistas.", conquistas: ["ACH_1"] },
  pergunta: "Vai encarar?",
  category: "MERCADO",
  platforms: ["PC"],
  games: ["outro-jogo"],
  imageLabel: "hollow knight",
  rumor: true,
};

function fakeAi(checks: boolean[] = []) {
  const calls: StructuredOpts<unknown>[] = [];
  const structured = vi.fn(async (opts: StructuredOpts<unknown>) => {
    calls.push(opts);
    if (opts.purpose === "write" || opts.purpose === "write-retry") return opts.schema.parse(DRAFT);
    if (opts.purpose === "check") {
      const ok = checks.length > 0 ? checks.shift()! : true;
      return opts.schema.parse(ok ? { ok: true, problems: [] } : { ok: false, problems: ["Número errado."] });
    }
    throw new Error(`unexpected ${opts.purpose}`);
  });
  return { ai: { structured, assertBudget: vi.fn() } as unknown as Ai, calls };
}

describe("writePauta", () => {
  it.each([
    ["vale-o-100", "GAMES", "Hollow Knight tem 20 conquistas: vale a pena caçar o 100%?"],
    ["mais-raras", "GAMES", "As 5 conquistas mais raras de Hollow Knight e o que cada uma pede"],
    ["perdiveis", "GUIAS", "Conquistas perdíveis de Hollow Knight: o que saber antes de começar"],
    ["iniciantes", "GUIAS", "Hollow Knight para iniciantes: por onde começar"],
  ] as const)("%s: category %s, the format's title, games = [slug]", async (format, category, title) => {
    const fake = fakeAi();
    const draft = await writePauta(fake.ai, sources(), format, "live", { now: NOW });
    expect(draft.category).toBe(category);
    expect(draft.title).toBe(title);
    expect(draft.games).toEqual(["hollow-knight"]);
    expect(draft.rumor).toBe(false);

    const write = fake.calls.find((c) => c.purpose === "write")!;
    expect(write.system).toBe(`${loadStyle()}\n\n${loadPautaStyle()}`);
    expect(write.fallbacks).toBe(true);
    expect(write.maxTokens).toBeLessThanOrEqual(16000);
    expect(write.user).toContain(title);
    expect(write.user).toContain("https://tralked.com/jogos/hollow-knight");
    expect(write.user).toContain("ACH_1");
    expect(write.user).toContain("Explore cavernas");
    expect(write.user).toContain("missable");
    // The checker sees the same sources (dossier, Steam and wiki).
    const check = fake.calls.find((c) => c.purpose === "check")!;
    expect(check.user).toContain("ACH_1");
    expect(check.user).toContain("Explore cavernas");
  });

  it("never sends fallbacks in the backfill bucket unless asked, and the pauta prompt is in pt-BR with the fixed copy", async () => {
    const fake = fakeAi();
    await writePauta(fake.ai, sources(), "iniciantes", "backfill", { now: NOW });
    expect(fake.calls.find((c) => c.purpose === "write")!.fallbacks).toBe(false);
    const style = loadPautaStyle();
    for (const copy of ["Equipe Tralked", "No Tralked", "Em 3 pontos", "Fontes", "vale a pena caçar o 100%?", "por onde começar"]) {
      expect(style).toContain(copy);
    }
  });

  it("throws PautaRejectedError when the check fails twice", async () => {
    const fake = fakeAi([false, false]);
    await expect(writePauta(fake.ai, sources(), "perdiveis", "live", { now: NOW })).rejects.toBeInstanceOf(PautaRejectedError);
    expect(fake.calls.map((c) => c.purpose)).toEqual(["write", "check", "write-retry", "check"]);
  });
});

describe("pautaKey and the famous games list", () => {
  it("uses its own idempotency keys", () => {
    expect(pautaKey("live", 7)).toBe("robo-pauta-live-7");
    expect(pautaKey("backfill", 12)).toBe("robo-pauta-backfill-12");
  });

  it("config/jogos-famosos.json holds about 150 valid, unique famous games", () => {
    const list = loadFamousGames();
    expect(list.length).toBeGreaterThanOrEqual(140);
    expect(new Set(list.map((g) => g.name.toLowerCase())).size).toBe(list.length);
    for (const g of list) {
      if (g.wiki !== undefined) expect(g.wiki).toMatch(/^https:\/\//);
      // A pauta needs Steam or wiki text: every entry has at least one of them.
      expect(g.wiki !== undefined || g.steamAppId !== undefined).toBe(true);
    }
    // Console-only games (no Steam) are in the list too.
    expect(list.some((g) => g.steamAppId === undefined)).toBe(true);
  });
});
