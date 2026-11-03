import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { FetchPage } from "../../src/guias/sources.js";
import {
  parseAchievementSchemaPage,
  parseAchievementXml,
  readSteamAliases,
  REFERENCE_STEAM_ID,
  steamAliasUrl,
  steamLanguagesIn,
  steamProfileXmlUrl,
} from "../../src/guias/steam-aliases.js";

// Hand-made in the format of Steam's community achievement XML (`/profiles/<id>/stats/<app>/achievements/?xml=1`),
// the same format the site's keyless Steam client reads (app/src/lib/integrations/steam/community.ts, whose tests
// hold trimmed real copies). Steam lowercases the apinames there.
const achievementXml = (rows: [apiname: string, name: string, description: string][]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><playerstats>
	<privacyState>public</privacyState>
	<visibilityState>3</visibilityState>
	<game><gameFriendlyName><![CDATA[4115450]]></gameFriendlyName><gameName><![CDATA[Phantom Blade Zero]]></gameName></game>
	<player><steamID64>${REFERENCE_STEAM_ID}</steamID64></player>
	<achievements>${rows
    .map(
      ([apiname, name, description]) => `
		<achievement closed="0">
			<iconClosed><![CDATA[https://shared.fastly.steamstatic.com/community_assets/images/apps/4115450/${apiname}.jpg]]></iconClosed>
			<name><![CDATA[${name}]]></name>
			<apiname><![CDATA[${apiname}]]></apiname>
			<description><![CDATA[${description}]]></description>
		</achievement>`,
    )
    .join("")}
	</achievements>
</playerstats>`;

const RUSSIAN = achievementXml([
  ["ach_heart", "Сердцем и кровью", "Всё тайное становится явным"],
  ["ach_lost", "Потерянное и найденное", "Выполнить [Просьбу Быстрой Руки]"],
]);
const SCHINESE = achievementXml([
  ["ach_heart", "逆天改命", "真相大白"],
  ["ach_lost", "失而复得", "完成【快手张的委托】"],
]);

const STEAM = [{ apiName: "ACH_HEART" }, { apiName: "ACH_LOST" }, { apiName: "ACH_OTHER" }];

describe("steamLanguagesIn", () => {
  it("detecta as línguas pelo texto e pelo idioma da fonte", () => {
    const zh = "《影之刃零》66项成就指南，包含流程与首领、支线、养成收集、战斗技巧，以及易错过提醒和真结局准备。".repeat(3);
    const ru = "Подробный гайд по всем 66 достижениям Phantom Blade Zero. Всё получается за одно прохождение.".repeat(2);
    const ja = "ファントムブレードゼロの全実績ガイドです。すべての実績を解除する方法を説明します。".repeat(2);
    const ko = "팬텀 블레이드 제로의 모든 도전 과제 공략입니다. 모든 도전 과제를 해제하는 방법.".repeat(2);
    expect(steamLanguagesIn([{ text: zh }])).toEqual(["schinese", "tchinese"]);
    expect(steamLanguagesIn([{ text: ru }])).toEqual(["russian"]);
    // Japanese uses kanji too: kana make it Japanese, not Chinese.
    expect(steamLanguagesIn([{ text: ja }])).toEqual(["japanese"]);
    expect(steamLanguagesIn([{ text: ko }])).toEqual(["koreana"]);
    expect(steamLanguagesIn([{ text: "An English page that names 影之刃零 once." }])).toEqual([]);
    expect(steamLanguagesIn([{ text: "short", language: "ru" }, { text: ru }, { text: zh }])).toEqual(["schinese", "tchinese", "russian"]);
  });
});

describe("parseAchievementXml", () => {
  it("lê apiname e nome de cada conquista", () => {
    expect(parseAchievementXml(RUSSIAN)).toEqual([
      { apiName: "ach_heart", name: "Сердцем и кровью" },
      { apiName: "ach_lost", name: "Потерянное и найденное" },
    ]);
  });

  it("perfil privado, página de erro ou HTML → null", () => {
    expect(parseAchievementXml("<?xml version=\"1.0\"?><response><error><![CDATA[This profile is private.]]></error></response>")).toBeNull();
    expect(parseAchievementXml("<html><body>Steam Community :: Error</body></html>")).toBeNull();
  });
});

describe("readSteamAliases", () => {
  it("lê a lista da Steam em cada língua e liga os nomes ao apiName da lista-mestre", async () => {
    const asked: string[] = [];
    const fetchPage: FetchPage = async (url) => {
      asked.push(url);
      if (url === steamProfileXmlUrl(4115450, "russian")) return { status: "ok", text: "", html: RUSSIAN, finalUrl: url };
      if (url === steamProfileXmlUrl(4115450, "schinese")) return { status: "ok", text: "", html: SCHINESE, finalUrl: url };
      return { status: "error", finalUrl: url, reason: "HTTP 500" };
    };
    const result = await readSteamAliases(4115450, ["russian", "schinese", "tchinese"], STEAM, fetchPage);
    // The schema page first (it answers 500 here), then the profile XML.
    expect(asked).toEqual(
      (["russian", "schinese", "tchinese"] as const).flatMap((l) => [steamAliasUrl(4115450, l), steamProfileXmlUrl(4115450, l)]),
    );
    expect(steamProfileXmlUrl(4115450, "russian")).toBe(
      `https://steamcommunity.com/profiles/${REFERENCE_STEAM_ID}/stats/4115450/achievements/?xml=1&l=russian`,
    );
    expect(result.aliases).toEqual({
      ACH_HEART: ["Сердцем и кровью", "逆天改命"],
      ACH_LOST: ["Потерянное и найденное", "失而复得"],
    });
    expect(result.read).toEqual(["russian", "schinese"]);
    expect(result.failed).toEqual([{ language: "tchinese", reason: "HTTP 500" }]);
  });

  it("segue o nome amigável do app quando a Steam redireciona a página", async () => {
    const friendly = `https://steamcommunity.com/profiles/${REFERENCE_STEAM_ID}/stats/PhantomBladeZero/?tab=achievements`;
    const retry = `https://steamcommunity.com/profiles/${REFERENCE_STEAM_ID}/stats/PhantomBladeZero/achievements/?xml=1&l=russian`;
    const fetchPage: FetchPage = async (url) =>
      url === retry
        ? { status: "ok", text: "", html: RUSSIAN, finalUrl: url }
        : { status: "ok", text: "", html: "<html><body>Achievements</body></html>", finalUrl: friendly };
    const result = await readSteamAliases(4115450, ["russian"], STEAM, fetchPage);
    expect(result.aliases.ACH_HEART).toEqual(["Сердцем и кровью"]);
  });

  it("lê o perfil de referência configurado", async () => {
    const asked: string[] = [];
    const fetchPage: FetchPage = async (url) => {
      asked.push(url);
      return { status: "ok", text: "", html: RUSSIAN, finalUrl: url };
    };
    // A schema page that is no achievement list (here the XML) is not read as one: the profile XML is next.
    await readSteamAliases(4115450, ["russian"], STEAM, fetchPage, "76561197960287930");
    expect(asked).toEqual([
      "https://steamcommunity.com/achievements/4115450?l=russian",
      "https://steamcommunity.com/profiles/76561197960287930/stats/4115450/achievements/?xml=1&l=russian",
    ]);
  });

  it("uma lista que não é a do jogo (nenhum apiName casa) não vale", async () => {
    const fetchPage: FetchPage = async (url) => ({ status: "ok", text: "", html: achievementXml([["other", "Чужое", "x"]]), finalUrl: url });
    const result = await readSteamAliases(4115450, ["russian"], STEAM, fetchPage);
    expect(result.aliases).toEqual({});
    expect(result.failed).toEqual([{ language: "russian", reason: "a lista da Steam não tem as conquistas do jogo" }]);
  });
});

// Trimmed from the live pages (2026-11-03, two polite GETs): `steamcommunity.com/achievements/4115450?l=<lang>`
// embeds the game's achievement schema in the language asked, apinames and hidden achievements included.
const fixture = (lang: string) => readFileSync(new URL(`./fixtures/steam-achievements-4115450-${lang}.html`, import.meta.url), "utf8");

describe("parseAchievementSchemaPage (página pública de conquistas do jogo)", () => {
  it("lê apiName e nome no idioma pedido, ocultas incluídas (chinês e russo, Phantom Blade Zero)", () => {
    const zh = parseAchievementSchemaPage(fixture("schinese"))!;
    expect(zh).toHaveLength(66);
    expect(zh).toContainEqual({ apiName: "ACH_043", name: "珀力非凡" });
    expect(zh).toContainEqual({ apiName: "ACH_066", name: "逆天改命" });
    // ACH_002 is hidden on Steam: the page still names it.
    expect(zh).toContainEqual({ apiName: "ACH_002", name: "逆行不逆心" });
    const ru = parseAchievementSchemaPage(fixture("russian"))!;
    expect(ru).toHaveLength(66);
    expect(ru).toContainEqual({ apiName: "ACH_013", name: "Сердцем и кровью" });
    expect(ru).toContainEqual({ apiName: "ACH_044", name: "Прислушиваясь к каждому цветку" });
  });

  it("página sem a lista (erro, outra página, JSON quebrado) → null", () => {
    expect(parseAchievementSchemaPage("<html><body>Steam Community :: Error</body></html>")).toBeNull();
    expect(parseAchievementSchemaPage('<script type="application/json" id="valve-ssr-data">{"renderContext":{"queryData":"{bad"}}</script>')).toBeNull();
    expect(parseAchievementSchemaPage(RUSSIAN)).toBeNull();
  });
});

describe("readSteamAliases: a página pública primeiro", () => {
  const PBZ = [
    { apiName: "ACH_013", name: "With Heart and Blood" },
    { apiName: "ACH_043", name: "Complete Mastery" },
  ];

  it("lê os nomes localizados da página do jogo, sem perfil nem XML", async () => {
    const asked: string[] = [];
    const fetchPage: FetchPage = async (url) => {
      asked.push(url);
      if (url === steamAliasUrl(4115450, "schinese")) return { status: "ok", text: "", html: fixture("schinese"), finalUrl: url };
      if (url === steamAliasUrl(4115450, "russian")) return { status: "ok", text: "", html: fixture("russian"), finalUrl: url };
      return { status: "error", finalUrl: url, reason: "HTTP 404" };
    };
    const result = await readSteamAliases(4115450, ["schinese", "russian"], PBZ, fetchPage);
    expect(steamAliasUrl(4115450, "schinese")).toBe("https://steamcommunity.com/achievements/4115450?l=schinese");
    expect(asked).toEqual([steamAliasUrl(4115450, "schinese"), steamAliasUrl(4115450, "russian")]);
    expect(result.aliases).toEqual({ ACH_013: ["昭昭心与血", "Сердцем и кровью"], ACH_043: ["珀力非凡", "Овладение мастерством"] });
    expect(result.read).toEqual(["schinese", "russian"]);
    expect(result.urls).toEqual({ schinese: steamAliasUrl(4115450, "schinese"), russian: steamAliasUrl(4115450, "russian") });
  });

  it("o XML do perfil que devolve os nomes em inglês (o que aconteceu no PBZ) não vale como lista localizada", async () => {
    const english = achievementXml([
      ["ach_013", "With Heart and Blood", "All Comes to Light"],
      ["ach_043", "Complete Mastery", "Collect 10 Sha-Chi Ambers"],
    ]);
    const fetchPage: FetchPage = async (url) =>
      url === steamProfileXmlUrl(4115450, "russian") ? { status: "ok", text: "", html: english, finalUrl: url } : { status: "error", finalUrl: url, reason: "HTTP 404" };
    const result = await readSteamAliases(4115450, ["russian"], PBZ, fetchPage);
    expect(result.aliases).toEqual({});
    expect(result.read).toEqual([]);
    expect(result.failed).toEqual([{ language: "russian", reason: "a Steam devolveu os nomes em inglês, não em russian" }]);
  });
});
