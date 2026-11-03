import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { BudgetExceededError } from "../../src/ai/client.js";
import { discoverSources, limitSearches, slugify } from "../../src/guias/discover.js";
import type { FetchPage } from "../../src/guias/sources.js";
import type { SearchHit } from "../../src/guias/websearch.js";

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const roadmapHtml = fx("powerpyx-pbz-roadmap.html");
const steamHtml = fx("steam-guides-4115450.html");

const game = { name: "Phantom Blade Zero", steamAppId: 4115450 };

function fetchPage(): { fetchPage: FetchPage; urls: string[] } {
  const urls: string[] = [];
  const fn: FetchPage = async (url) => {
    urls.push(url);
    if (url.startsWith("https://www.powerpyx.com/")) return { status: "ok", html: roadmapHtml, text: "", finalUrl: url };
    if (url.startsWith("https://steamcommunity.com/app/")) return { status: "ok", html: steamHtml, text: "", finalUrl: url };
    return { status: "error", finalUrl: url, reason: "unexpected" };
  };
  return { fetchPage: fn, urls };
}

describe("discoverSources", () => {
  it("monta a URL do PowerPyx a partir do nome", async () => {
    expect(slugify("Phantom Blade Zero")).toBe("phantom-blade-zero");
    const f = fetchPage();
    const sources = await discoverSources(game, { fetchPage: f.fetchPage, search: async () => [] });
    expect(f.urls[0]).toBe("https://www.powerpyx.com/phantom-blade-zero-trophy-guide-roadmap/");
    expect(sources[0]).toMatchObject({
      url: "https://www.powerpyx.com/phantom-blade-zero-trophy-guide-roadmap/",
      role: "roteiro_psn",
    });
    expect(sources.some((s) => s.url === "https://www.truesteamachievements.com/game/Phantom-Blade-Zero/achievements")).toBe(true);
  });

  it("pega os links de região da página do roadmap", async () => {
    const sources = await discoverSources(game, { fetchPage: fetchPage().fetchPage, search: async () => [] });
    const coletaveis = sources.filter((s) => s.role === "coletaveis").map((s) => s.url);
    expect(coletaveis.filter((u) => u.endsWith("-collectible-locations/"))).toHaveLength(9); // the 9 regions
    expect(coletaveis).toHaveLength(10); // + the collectibles guide
    expect(coletaveis).toContain("https://www.powerpyx.com/phantom-blade-zero-weeping-creek-valley-collectible-locations/");
    expect(coletaveis).toContain("https://www.powerpyx.com/phantom-blade-zero-crimson-forest-collectible-locations/");
    expect(coletaveis).toContain("https://www.powerpyx.com/phantom-blade-zero-collectibles-guide-100-completion/");
    expect(new Set(coletaveis).size).toBe(10);
  });

  it("escolhe os 3 guias Steam que dizem 100%", async () => {
    const f = fetchPage();
    const sources = await discoverSources(game, { fetchPage: f.fetchPage, search: async () => [] });
    expect(f.urls).toContain(
      "https://steamcommunity.com/app/4115450/guides/?browsefilter=toprated&requiredtags[]=Achievements",
    );
    const steam = sources.filter((s) => s.role === "roteiro_steam" && s.url.includes("steamcommunity.com"));
    expect(steam.map((s) => s.url.split("id=")[1])).toEqual(["3829258710", "3829266508", "3829693154"]);
    expect(steam[0]!.language).toBe("zh");
  });

  it("limita a 6 buscas na web", async () => {
    const search = vi.fn(async (): Promise<SearchHit[]> => []);
    await discoverSources(game, { fetchPage: fetchPage().fetchPage, search });
    expect(search.mock.calls.length).toBeLessThanOrEqual(6);

    const raw = vi.fn(async (): Promise<SearchHit[]> => []);
    const limited = limitSearches(raw, 6);
    for (let i = 0; i < 10; i++) await limited(`q${i}`);
    expect(raw).toHaveBeenCalledTimes(6);
  });

  it("transforma resultados de busca em fontes dos sites conhecidos e ignora o resto", async () => {
    const search = async (q: string): Promise<SearchHit[]> =>
      q.includes("psnprofiles")
        ? [
            { title: "PBZ trophies", url: "https://psnprofiles.com/guide/123-phantom-blade-zero-trophy-guide" },
            { title: "spam", url: "https://example.org/x" },
          ]
        : [];
    const sources = await discoverSources(game, { fetchPage: fetchPage().fetchPage, search });
    expect(sources.find((s) => s.name === "PSNProfiles")).toMatchObject({ role: "roteiro_psn" });
    expect(sources.some((s) => s.url.includes("example.org"))).toBe(false);
  });

  it("segue sem as fontes determinísticas quando a página é bloqueada", async () => {
    const blocked: FetchPage = async (url) => ({ status: "challenge", finalUrl: url });
    const sources = await discoverSources(game, { fetchPage: blocked, search: async () => [] });
    expect(sources.map((s) => s.role).sort()).toEqual(["roteiro_psn", "roteiro_steam"]);
  });
  it("atribui o papel certo a cada site achado na busca", async () => {
    const expected: Record<string, string> = {
      "https://psnprofiles.com/guide/1": "roteiro_psn",
      "https://grindnstrat.com/pbz": "coletaveis",
      "https://game8.co/games/pbz": "coletaveis",
      "https://www.ign.com/wikis/pbz": "coletaveis",
      "https://games.gg/pbz": "coletaveis",
      "https://allthings.how/pbz": "coletaveis",
      "https://pbz.fandom.com/wiki/Trophies": "coletaveis",
      "https://pbz.wiki.fextralife.com/Trophies": "coletaveis",
      "https://mobalytics.gg/pbz": "coletaveis",
      "https://www.reddit.com/r/pbz/1": "confirmacao",
    };
    const hits = Object.keys(expected).map((url) => ({ title: url, url }));
    const sources = await discoverSources(game, {
      fetchPage: fetchPage().fetchPage,
      search: async (q) => (q.includes("psnprofiles") ? hits : []),
    });
    for (const [url, role] of Object.entries(expected)) {
      expect(sources.find((s) => s.url === url), url).toMatchObject({ role });
    }
    expect(sources.find((s) => s.name === "TrueSteamAchievements")?.role).toBe("roteiro_steam");
    expect(sources.find((s) => s.name === "PowerPyx")?.role).toBe("roteiro_psn");
  });

  it("repassa erro de orçamento e de credencial da busca", async () => {
    const budget = async (): Promise<SearchHit[]> => {
      throw new BudgetExceededError("backfill", 70, 70);
    };
    await expect(discoverSources(game, { fetchPage: fetchPage().fetchPage, search: budget })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    const auth = async (): Promise<SearchHit[]> => {
      throw Object.assign(new Error("invalid x-api-key"), { status: 401 });
    };
    await expect(discoverSources(game, { fetchPage: fetchPage().fetchPage, search: auth })).rejects.toThrow(/x-api-key/);
  });

  it("registra falha comum de uma busca e segue com as outras", async () => {
    const failures: string[] = [];
    let n = 0;
    const search = async (q: string): Promise<SearchHit[]> => {
      if (n++ === 0) throw new Error("timeout");
      return q.includes("grindnstrat") ? [{ title: "g", url: "https://grindnstrat.com/pbz" }] : [];
    };
    const sources = await discoverSources(game, {
      fetchPage: fetchPage().fetchPage,
      search,
      onSearchFailure: (q, e) => failures.push(`${q}: ${(e as Error).message}`),
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/timeout/);
    expect(sources.some((s) => s.name === "Grindnstrat")).toBe(true);
  });
});
