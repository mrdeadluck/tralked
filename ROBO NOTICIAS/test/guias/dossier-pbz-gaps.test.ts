import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDossier, type GuideDossierSource, type SteamAchievement } from "../../src/guias/dossier.js";
import type { ExtractedFacts } from "../../src/guias/facts.js";
import { gate } from "../../src/guias/gate.js";
import { buildReport } from "../../src/guias/report.js";
import { writeGuideDetailed } from "../../src/guias/writer.js";
import { parseAchievementSchemaPage } from "../../src/guias/steam-aliases.js";
import { ach, fact, item, steamAch } from "./helpers-dossier.js";
import { fakeAi, keysIn } from "./helpers-writer.js";

/**
 * Task 18: the gaps that kept Phantom Blade Zero in waiting_sources on the third live run (2026-11-03), with the
 * real Steam rows, the real how-tos and milestones the sources gave, and the real collectible types of the PowerPyx
 * region pages (counts as extracted on that run).
 */

const PBZ: SteamAchievement[] = [
  steamAch("ACH_043", "Complete Mastery", "Collect 10 Sha-Chi Ambers"),
  steamAch("ACH_045", "Leave No Stone Unturned", "Collect 10 Blackstones"),
  steamAch("ACH_046", "Collector’s Notes", "Collect 30 Accessories"),
  steamAch("ACH_044", "Listen to Every Flower", "Collect 10 Memory Flowers"),
  steamAch("ACH_038", "The Healer’s Legacy", "Complete [Flesh Lily], [Apprentice Healer], and [A Healer’s Mercy]"),
  steamAch("ACH_039", "Lost and Found", "Complete All [Quick Hand’s Requests]"),
  steamAch("ACH_027", "All Dreams Must End", "All Schemes Come to Nothing"),
  steamAch("ACH_013", "With Heart and Blood", "All Comes to Light"),
  steamAch("ACH_029", "The Four Freed", "Defeat the Four Great Puppets: Yuzan, Yubi, Yuding, and Yucong"),
  steamAch("ACH_037", "Spectral Blade", "Complete [A Severed Mindseal]"),
  steamAch("ACH_033", "Phantom and Blade", "Complete [Bloodline Awakening]"),
  steamAch("ACH_032", "Forbidden Arts Beneath the Lake", "Complete [Secrets at the Heart of the Lake]"),
  steamAch("ACH_025", "The White Shadow", "Defeat the Blizzard Blademaster"),
  steamAch("ACH_023", "Nothing Goes to Waste", "Defeat the Puppet Scavenger"),
  steamAch("ACH_022", "Crossroads of Blood", "Defeat Huangxing, the Kunlun Renegade"),
  steamAch("ACH_034", "The Last of Baishan", "Complete [Secrets of the Baishan Sect]"),
  steamAch("ACH_021", "Sword Against the Seven-Stars", "Defeat the Chief Disciple of the Seven-Stars"),
  steamAch("ACH_015", "Scarlet Wraithblade", "Defeat Hua, the Bride"),
];

/** How-tos and milestones as the run's dossier had them (PowerPyx's first, else Fextralife's / allthings.how's). */
const MISSABLES: [nameEn: string, howTo: string, missableUntil?: string][] = [
  [
    "Lost and Found",
    "Complete All [Quick Hand’s Requests]: collect all treasures in each region (Crimson Forest 3, Village of Lu 3, Pangzhen 4, Meigu Lake 4, Mirage Estate 3) and return them to Quick Hand Zhang.",
  ],
  ["All Dreams Must End", "All Schemes Come to Nothing. Defeat Meng Hua, the Merciful Lady of the Blossom Veil, the normal final boss."],
  ["With Heart and Blood", "All Comes to Light. Awarded for completing the true ending of the game."],
  [
    "The Four Freed",
    "Defeat the Four Great Puppets: Yuzan (end of Village of Lu), Yubi (end of Mandate Encampment), Yuding (midway through Mirage Estate), Yucong (across the frozen lake in Crimson Forest, Triple Threat side quest; rest of steps after reaching Mirage Estate and progressing through the snowed-over area of Crimson Forest).",
  ],
  [
    "Spectral Blade",
    "Complete [A Severed Mindseal]: accept from Shadow Warden at Valley Sha-Chi Tower Summit Bell, get the Furnace Inspection Crank and Primal Stone; second step at Sha-Chi Tower in Meigu Lake; third step at Sha-Chi Tower in Crimson Forest after Mirage Estate when southeast is snowed over.",
    "exiting Region 1: Weeping Valley Creek",
  ],
  [
    "Phantom and Blade",
    "Complete [Bloodline Awakening], accepted on finding the first Long Pillar; complete all 5 Long Pillar encounters (Weeping Creek Valley, Crimson Forest, Meigu Lake East, Meigu Lake Phantom Illusionist Ruins, Pangzhen).",
  ],
  [
    "Forbidden Arts Beneath the Lake",
    "Complete [Secrets at the Heart of the Lake], accepted when collecting one of Firefly’s Memory Flowers in the Village of Lu; multiple steps related to the true ending, see True Ending Guide.",
  ],
  ["The White Shadow", "Defeat the Blizzard Blademaster, an optional boss at the end of the Phantom Illusionist Ruins area in Meigu Lake."],
  ["Nothing Goes to Waste", "Defeat the Puppet Scavenger, an optional boss in Weeping Creek Valley, in the Crimson Manor side area."],
  ["Crossroads of Blood", "Defeat Huangxing, the Kunlun Renegade, an optional boss at the end of Mountain of Imprisonment."],
  [
    "The Healer’s Legacy",
    "Complete [Flesh Lily], [Apprentice Healer], and [A Healer’s Mercy]: bring Flesh Lily to Yu’er, collect 3 herbs in Weeping Creek Valley, heal 4 thieves in Crimson Forest, then use the Flesh Lily on the old man in Yu’er’s home in Pangzhen after defeating Chang Hong.",
    "defeating Jing Ye, The Outlaw / Bai Chilian, Lady of the Twin Serpents",
  ],
  [
    "The Last of Baishan",
    "Complete [Secrets of the Baishan Sect]: accept from Lanlan on the giant bridge near Thieves’ Camp Bell in Crimson Forest before defeating Bai Chilian; get the Cellar Crank at Cliffside Lodge Bell and the Secret Chamber Crank, talk to the girl; then at The Confinement Bell in Mandate Encampment defeat Wu Lengshuang.",
    "defeating Bai Chilian, Lady of the Twin Serpents",
  ],
  ["Sword Against the Seven-Stars", "Defeat the Chief Disciple of the Seven-Stars, an optional boss midway through Mandate Encampment."],
  [
    "Scarlet Wraithblade",
    "Defeat Hua, the Bride, an optional boss in Weeping Creek Valley. From the Valley Sha-Chi Tower 1st Floor Bell, go behind the tower on the right, slide down the wooden bridge through the hole in the ground, follow the path left to the end.",
  ],
];

type Item = ExtractedFacts["chapters"][number]["items"][number];
const many = (n: number, type: string, extra: Partial<Item> = {}) =>
  Array.from({ length: n }, (_, i) => item(type, { collectibleType: type, location: `ponto ${i + 1}`, ...extra }));
const page = (label: string, slug: string, chapters: { title: string; region: string; items: Item[] }[]) =>
  fact(`PowerPyx (${label})`, "coletaveis", { chapters: chapters.map((c, i) => ({ ...c, order: i + 1 })) }, `https://www.powerpyx.com/phantom-blade-zero-${slug}-collectible-locations/`);

/** The PowerPyx roadmap (primary script) and its region pages, in story order; the real types and counts. */
function powerpyx(collectibles: { ambers?: number; blackstones?: number } = {}): ExtractedFacts[] {
  const roadmap = fact(
    "PowerPyx",
    "roteiro_psn",
    {
      achievements: [
        ach("Listen to Every Flower", { howTo: "Collect 10 full Memory Flowers (each has 2-6 petals)." }),
        ach("Collector’s Notes", { howTo: "Collect a total of 30 accessories (over 60 in the game)." }),
        // Fextralife's and allthings.how's how-tos on the real run.
        ach("Complete Mastery", { howTo: "Collect 10 Sha-Chi Ambers" }),
        ach("Leave No Stone Unturned", { howTo: "Collect 10 Blackstones" }),
        ...MISSABLES.map(([nameEn, howTo, missableUntil]) => ach(nameEn, { howTo, missable: true, ...(missableUntil ? { missableUntil } : {}) })),
      ],
      roadmap: [{ title: "Step 1: Complete the Game up to the Mirage Estate", summary: "Play through normally." }],
    },
    "https://www.powerpyx.com/phantom-blade-zero-trophy-guide-roadmap/",
  );
  const ambers = collectibles.ambers ?? 24;
  const blackstones = collectibles.blackstones ?? 24;
  return [
    roadmap,
    page("Weeping Creek Valley", "weeping-creek-valley", [
      {
        title: "First Visit",
        region: "Weeping Creek Valley",
        items: [
          item("A Severed Mindseal (Tales)", { collectibleType: "Tales" }),
          ...many(12, "Accessory"),
          ...many(Math.ceil(ambers / 3), "Sha-Chi Amber Fragment"),
          ...many(Math.ceil(blackstones / 3), "Blackstone Fragment"),
          ...many(20, "Memory Flower"),
          ...many(3, "Accessory Fragment"),
        ],
      },
    ]),
    page("Crimson Forest", "crimson-forest", [
      {
        title: "First Visit",
        region: "Crimson Forest",
        items: [
          item("Outlaw Warblade (Weapon)", { collectibleType: "Weapon", location: "Reward for defeating Jing Ye, The Outlaw. Story-related." }),
          ...many(12, "Accessory"),
          ...many(Math.floor(ambers / 3), "Sha-Chi Amber Fragment"),
          ...many(Math.floor(blackstones / 3), "Blackstone Fragment"),
          ...many(30, "Memory Flower"),
        ],
      },
    ]),
    page("Village Of Lu", "village-of-lu", [{ title: "First Visit", region: "Village of Lu", items: many(8, "Accessory") }]),
    page("Pangzhen", "pangzhen", [{ title: "First Visit", region: "Pangzhen", items: many(8, "Accessory") }]),
    page("Mandate Encampment", "mandate-encampment", [
      { title: "Mandate Encampment", region: "Mandate Encampment", items: [...many(8, "Accessory"), ...many(19, "Memory Flower")] },
    ]),
    page("Meigu Lake", "meigu-lake", [
      { title: "First Visit", region: "Meigu Lake", items: [...many(15, "Memory Flower"), ...many(ambers - Math.ceil(ambers / 3) - Math.floor(ambers / 3), "Sha-Chi Amber Fragment")] },
      { title: "Second Visit", region: "Meigu Lake", items: [item("Whiteshadow", { location: "Reward for defeating Blizzard Blademaster." })] },
    ]),
    page("Mountain Of Imprisonment", "mountain-of-imprisonment", [
      {
        title: "Mountain of Imprisonment",
        region: "Mountain of Imprisonment",
        items: [...many(9, "Memory Flower"), ...many(blackstones - Math.ceil(blackstones / 3) - Math.floor(blackstones / 3), "Blackstone Fragment")],
      },
    ]),
    page("Mirage Estate Pangzhen", "mirage-estate-pangzhen", [{ title: "Mirage Estate", region: "Mirage Estate", items: many(3, "Memory Flower of the Monster") }]),
    page("Mount Soulrend", "mount-soulrend", [
      {
        title: "Mount Soulrend",
        region: "Mount Soulrend",
        items: [
          item("Boss: Meng Hua, the Merciful Lady of the Blossom Veil", { kind: "boss", location: "After the Bell The Last Chance (point of no return)" }),
          item("Boss: Zho Shang", { kind: "boss", location: "Gold portal at the top of the cliff (requires true ending steps)" }),
        ],
      },
    ]),
  ];
}

/** Game8 lists the same achievements as not missable. */
const game8 = () =>
  fact("Game8", "coletaveis", { achievements: MISSABLES.map(([nameEn]) => ach(nameEn, { missable: false })) }, "https://game8.co/games/Phantom-Blade-Zero/archives/634842");

const build = (facts: ExtractedFacts[], aliases: Record<string, string[]> = {}) =>
  buildDossier(PBZ, facts, facts.map((f) => [f.source.url]).reduce<string[][]>((groups, [url]) => {
    // The PowerPyx pages are one source (same site), every other page its own.
    const pp = groups.find((g) => g[0]!.includes("powerpyx.com"));
    if (url!.includes("powerpyx.com") && pp) pp.push(url!);
    else groups.push([url!]);
    return groups;
  }, []), [], aliases);

const achOf = (d: ReturnType<typeof build>, apiName: string) => d.achievements.find((a) => a.apiName === apiName)!;

const GAME: GuideDossierSource = {
  game: {
    slug: "phantom-blade-zero",
    name: "Phantom Blade Zero",
    steamAppId: 4115450,
    summary: null,
    developer: "S-GAME",
    publisher: "S-GAME",
    releaseDate: "2026-10-29",
    platforms: ["PC"],
    criticScore: null,
    timeToBeatCompleteMin: null,
    achievementCount: PBZ.length,
  },
  tralked: { players: 0, avgPlaytimeMin: null, completedPlayers: 0 },
  achievements: PBZ,
};

describe("A: 'collect N' conta os itens do tipo que a conquista nomeia", () => {
  it("Collector’s Notes (30 Accessories): os 48 acessórios das páginas de região contam, ligados por tipo e sem revisão", () => {
    const d = build(powerpyx());
    const notes = achOf(d, "ACH_046");
    expect(notes.collect).toMatchObject({ target: 30, counted: 48, byType: { type: "Accessory", ambiguous: false, unconverted: 3 } });
    const accessories = d.chapters.flatMap((c) => c.items).filter((i) => i.collectibleType === "Accessory");
    expect(accessories).toHaveLength(48);
    for (const a of accessories) expect(a).toMatchObject({ countsFor: ["ACH_046"], countedByType: "exact" });
    // "Accessory Fragment" has no conversion rule: it is not counted (and not linked).
    for (const f of d.chapters.flatMap((c) => c.items).filter((i) => i.collectibleType === "Accessory Fragment")) expect(f.countsFor).toEqual([]);
    expect(gate(d, PBZ).missing.filter((m) => m.includes("ACH_046"))).toEqual([]);
  });

  it("Complete Mastery / Leave No Stone Unturned: fragmentos sem regra de conversão nas fontes não contam como Âmbar / Pedra Negra", () => {
    const d = build(powerpyx());
    expect(achOf(d, "ACH_043").collect).toMatchObject({ target: 10, counted: 0, byType: { type: "Sha-Chi Amber", unconverted: 24 } });
    expect(achOf(d, "ACH_045").collect).toMatchObject({ target: 10, counted: 0, byType: { type: "Blackstone", unconverted: 24 } });
    const missing = gate(d, PBZ).missing;
    expect(missing).toContain(
      'A conquista "Complete Mastery" (ACH_043) pede 10, mas os itens encontrados somam 0 (24 fragmentos sem regra de conversão nas fontes).',
    );
  });

  it("com a regra do guia chinês (每4块碎片合成1块, ligado pelo nome da Steam em chinês), 24 fragmentos são 6 e 40 são 10", () => {
    const zh = parseAchievementSchemaPage(readFileSync(new URL("./fixtures/steam-achievements-4115450-schinese.html", import.meta.url), "utf8"))!;
    const aliases = Object.fromEntries(zh.filter((r) => PBZ.some((s) => s.apiName === r.apiName)).map((r) => [r.apiName, [r.name]]));
    const lankec = fact(
      "Steam: 影之刃零全成就指南 (Lankec)",
      "roteiro_steam",
      {
        achievements: [
          ach("珀力非凡", { howTo: "集齐了10块杀气琥珀；每4块碎片合成1块杀气琥珀，共需40块碎片" }),
          ach("取石有道", { howTo: "集齐了10块黑石；每4块碎片合成1块黑石，共需40块碎片" }),
        ],
        complete: false,
      },
      "https://steamcommunity.com/sharedfiles/filedetails/?id=3829258710",
    );
    const short = build([...powerpyx(), lankec], aliases);
    expect(achOf(short, "ACH_043").collect).toMatchObject({ target: 10, counted: 6, byType: { type: "Sha-Chi Amber", unconverted: 0 } });
    expect(achOf(short, "ACH_045").collect).toMatchObject({ counted: 6 });
    expect(gate(short, PBZ).missing).toContain('A conquista "Complete Mastery" (ACH_043) pede 10, mas os itens encontrados somam 6.');

    const full = build([...powerpyx({ ambers: 40, blackstones: 40 }), lankec], aliases);
    expect(achOf(full, "ACH_043").collect).toMatchObject({ counted: 10 });
    expect(achOf(full, "ACH_045").collect).toMatchObject({ counted: 10 });
    expect(gate(full, PBZ).missing.filter((m) => /ACH_04[35]/.test(m))).toEqual([]);
  });

  it("Listen to Every Flower: a fonte diz 2–6 pétalas por flor, então cada 'Memory Flower' conta 1/6 (limite inferior, revisão)", () => {
    const d = build(powerpyx());
    const flowers = achOf(d, "ACH_044");
    // 93 'Memory Flower' / 6 = 15.5 at least. 'Memory Flower of the Monster' only contains the name: linked for
    // review, out of the count.
    expect(flowers.collect).toMatchObject({ target: 10, counted: 15.5, byType: { type: "Memory Flower", ambiguous: true } });
    const petals = d.chapters.flatMap((c) => c.items).filter((i) => i.collectibleType?.startsWith("Memory Flower"));
    expect(petals).toHaveLength(96);
    for (const p of petals) expect(p).toMatchObject({ countsFor: ["ACH_044"], countedByType: "ambiguous" });
    expect(gate(d, PBZ).missing.filter((m) => m.includes("ACH_044"))).toEqual([]);
  });

  it("pétalas tipadas como parte ('Memory Flower Petal') sem regra fixa: com '2-6 petals' contam 1/6, para revisão", () => {
    const steam = [steamAch("ACH_044", "Listen to Every Flower", "Collect 10 Memory Flowers")];
    const lead = fact("PowerPyx", "roteiro_psn", {
      achievements: [ach("Listen to Every Flower", { howTo: "Collect 10 full Memory Flowers (each has 2-6 petals)." })],
      chapters: [{ title: "Chapter 1", region: "Weeping Creek Valley", order: 1, items: many(66, "Memory Flower Petal") }],
    });
    const d = buildDossier(steam, [lead], [[lead.source.url]]);
    expect(d.achievements[0]!.collect).toMatchObject({ target: 10, counted: 11, byType: { type: "Memory Flower", ambiguous: true, unconverted: 0 } });
    expect(d.chapters[0]!.items.every((i) => i.countedByType === "ambiguous")).toBe(true);
  });

  it("tipo que só contém o nome ('Relic Key' para 'Collect 5 Relics') fica ligado para revisão, mas fora da contagem", () => {
    const steam = [steamAch("ACH_R", "Relic Hunter", "Collect 5 Relics")];
    const lead = fact("PowerPyx", "roteiro_psn", {
      achievements: [ach("Relic Hunter")],
      chapters: [{ title: "Chapter 1", region: "Weeping Creek Valley", order: 1, items: [...many(5, "Relic Key"), ...many(2, "Relic")] }],
    });
    const d = buildDossier(steam, [lead], [[lead.source.url]]);
    expect(d.achievements[0]!.collect).toMatchObject({ target: 5, counted: 2, byType: { type: "Relic", ambiguous: true } });
    const keys = d.chapters[0]!.items.filter((i) => i.collectibleType === "Relic Key");
    for (const k of keys) expect(k).toMatchObject({ countsFor: ["ACH_R"], countedByType: "ambiguous" });
    expect(gate(d, steam).missing).toContain('A conquista "Relic Hunter" (ACH_R) pede 5, mas os itens encontrados somam 2.');
  });

  it("o nome diz que é parte: 'Sha-Chi Amber Shard' com tipo 'Sha-Chi Amber' (ou 'Upgrade') é fragmento, sem regra não conta", () => {
    const steam = [steamAch("ACH_043", "Complete Mastery", "Collect 10 Sha-Chi Ambers")];
    const lead = fact("PowerPyx", "roteiro_psn", {
      achievements: [ach("Complete Mastery")],
      chapters: [
        {
          title: "Chapter 1",
          region: "Weeping Creek Valley",
          order: 1,
          items: [
            ...many(10, "Sha-Chi Amber", { name: "Sha-Chi Amber Shard" }),
            // The Mirage Estate page's "Upgrade: Sha-Chi Amber Fragment": typed by the page's label, named by the thing.
            ...many(4, "Upgrade", { name: "Sha-Chi Amber Fragment" }),
          ],
        },
      ],
    });
    const d = buildDossier(steam, [lead], [[lead.source.url]]);
    expect(d.achievements[0]!.collect).toMatchObject({ counted: 0, byType: { unconverted: 14 } });
    const ruled = { ...lead, achievements: [ach("Complete Mastery", { howTo: "Collect 10 Sha-Chi Ambers; 4 shards combine into a whole Amber." })] };
    const withRule = buildDossier(steam, [ruled], [[lead.source.url]]);
    expect(withRule.achievements[0]!.collect).toMatchObject({ counted: 3.5, byType: { unconverted: 0 } });
  });

  it("The Healer’s Legacy: o 'collect 3 herbs' no meio do como-fazer não é a meta da conquista (ela pede 3 contos, não 3 ervas)", () => {
    const d = build(powerpyx());
    expect(achOf(d, "ACH_038").collect).toBeUndefined();
    expect(gate(d, PBZ).missing.filter((m) => m.includes("ACH_038") && m.includes("pede"))).toEqual([]);
  });
});

describe("B: perdível sem capítulo ligado por região, nome ou menção no texto", () => {
  /** apiName -> [anchor (start or collect before here), the last region or boss its texts name]. */
  const expected: Record<string, [string, string]> = {
    // (1) the milestone, whole (region, then boss), before the how-to.
    ACH_037: ["First Visit — Weeping Creek Valley", "Mirage Estate"], // "Weeping Valley Creek": same words, other order
    ACH_038: ["First Visit — Crimson Forest", "First Visit — Pangzhen"], // "defeating Jing Ye": the route item of that boss
    // (2) a region the how-to names: the earliest is the anchor; the last is only the default spot.
    ACH_039: ["First Visit — Crimson Forest", "Mirage Estate"],
    ACH_029: ["First Visit — Crimson Forest", "Mirage Estate"],
    ACH_033: ["First Visit — Weeping Creek Valley", "First Visit — Meigu Lake"],
    ACH_032: ["First Visit — Village of Lu", "First Visit — Village of Lu"],
    ACH_025: ["First Visit — Meigu Lake", "First Visit — Meigu Lake"],
    ACH_023: ["First Visit — Weeping Creek Valley", "First Visit — Weeping Creek Valley"], // "Crimson Manor" is no "Crimson Forest"
    ACH_022: ["Mountain of Imprisonment", "Mountain of Imprisonment"],
    ACH_034: ["First Visit — Crimson Forest", "Mandate Encampment"],
    ACH_021: ["Mandate Encampment", "Mandate Encampment"],
    ACH_015: ["First Visit — Weeping Creek Valley", "First Visit — Weeping Creek Valley"],
    // (3) the boss it names is an item of the route.
    ACH_027: ["Mount Soulrend", "Mount Soulrend"],
    // (4) a route item's text places it ("requires true ending steps").
    ACH_013: ["Mount Soulrend", "Mount Soulrend"],
  };

  it("os 14 perdíveis do PBZ ganham uma âncora de aviso, sem prazo de conclusão no capítulo dela; o gate não acusa nenhum", () => {
    const d = build([...powerpyx(), game8()]);
    for (const [apiName, [warn, done]] of Object.entries(expected)) {
      const a = achOf(d, apiName);
      expect(a, apiName).toMatchObject({ missable: true, warnChapter: warn, doneChapter: done, deadlineAssumed: true });
      expect(a.deadlineChapter, apiName).toBeUndefined();
    }
    expect(gate(d, PBZ).missing.filter((m) => m.includes("não está ligado"))).toEqual([]);
  });

  it("Lost and Found pode ficar depois da Mirage Estate e recebe o aviso no capítulo da âncora", async () => {
    const d = build([...powerpyx(), game8()]);
    const { ai } = fakeAi({
      chapter: (out, prompt) => {
        const step = keysIn(prompt, "passo").find((k) => k.startsWith("mount-soulrend"));
        if (step) out.passos.find((p) => p.key === step)!.conquistas.push("ACH_039");
      },
    });
    const { payload, repairs } = await writeGuideDetailed(ai, d, GAME, "live");
    const chapters = payload.walkthrough.chapters;
    const placed = chapters.find((c) => c.steps.some((s) => s.items.some((i) => i.achievement === "ACH_039")))!;
    expect(placed.key).toBe("mount-soulrend");
    expect(repairs.some((r) => r.text.includes("ACH_039") && r.text.includes("depois do capítulo"))).toBe(false);
    const anchor = chapters.find((c) => c.key === "first-visit-crimson-forest")!;
    const warn = anchor.steps[0]!.body.find((b) => b.type === "callout" && b.tone === "aviso" && b.text.includes("Lost and Found"));
    expect(warn).toBeDefined();
  });

  it("marco 'before entering Pangzhen' (Together Till the End): a âncora é o capítulo antes do primeiro de Pangzhen", () => {
    const steam = [...PBZ, steamAch("ACH_035", "Together Till the End", "Complete [The Journey Home]")];
    const facts = powerpyx();
    facts[0]!.achievements.push(
      ach("Together Till the End", {
        missable: true,
        missableUntil: "entering Pangzhen",
        howTo: "Complete [The Journey Home]: accept from Old Man Gen in Village of Lu, after opening the locked door into Pangzhen return to him.",
      }),
    );
    const d = buildDossier(steam, facts, [facts.map((f) => f.source.url)]);
    expect(d.achievements.find((a) => a.apiName === "ACH_035")).toMatchObject({
      warnChapter: "First Visit — Village of Lu",
      doneChapter: "First Visit — Pangzhen",
      deadlineAssumed: true,
    });
  });

  it("sem o modelo pôr, a conquista vai para o fim do último capítulo que os textos dela citam (não para antes da âncora)", async () => {
    const d = build([...powerpyx(), game8()]);
    const { payload } = await writeGuideDetailed(fakeAi().ai, d, GAME, "live");
    const placed = payload.walkthrough.chapters.find((c) => c.steps.some((s) => s.items.some((i) => i.achievement === "ACH_039")))!;
    expect(placed.key).toBe("mirage-estate");
  });

  it("fontes discordam se é perdível (Game8 diz que não): continua perdível, com o conflito marcado", () => {
    const d = build([...powerpyx(), game8()]);
    expect(achOf(d, "ACH_025")).toMatchObject({ missable: true, conflict: expect.stringContaining("não perdível segundo Game8") });
  });

  it("sem região, nome ou menção que resolva, o gate continua falhando", () => {
    const steam = [steamAch("ACH_X", "Lonely Path", "Walk alone")];
    const lead = fact("PowerPyx", "roteiro_psn", {
      achievements: [ach("Lonely Path", { missable: true, howTo: "Do it before it is too late." })],
      chapters: [{ title: "Chapter 1", region: "Weeping Creek Valley", order: 1, items: [item("Bell")] }],
    });
    const d = buildDossier(steam, [lead], [[lead.source.url]]);
    expect(d.achievements[0]!.deadlineChapter).toBeUndefined();
    expect(gate(d, steam).missing).toContain(
      'O perdível "Lonely Path" (ACH_X) não está ligado a nenhum capítulo: o "até quando" das fontes não aponta para um capítulo e nenhum item do roteiro é ele.',
    );
  });
});

describe("C: extração que perdeu itens (R32: página do roteiro principal reprova a porta)", () => {
  it("a página dizia 76 entradas e a extração trouxe 18 mesmo relendo em partes: divergência e lacuna da porta", () => {
    const facts = powerpyx();
    facts.find((f) => f.source.name === "PowerPyx (Village Of Lu)")!.shortfall = { stated: 76, extracted: 18 };
    const d = build(facts);
    const sentence =
      "Extração incompleta: PowerPyx (Village Of Lu) diz ter 76 entradas e a extração trouxe 18, mesmo relendo a página em partes; a rota dessa página pode estar incompleta. Revise antes de publicar.";
    expect(d.divergences[0]).toBe(sentence);
    expect(gate(d, PBZ).missing).toContain(sentence);
  });

  it("um tipo abaixo do total da página que conta para uma conquista reprova; um tipo que não conta, só avisa", () => {
    const facts = powerpyx();
    facts.find((f) => f.source.name === "PowerPyx (Crimson Forest)")!.shortfall = {
      stated: 83,
      extracted: 80,
      types: [
        { label: "Sha-Chi Amber Shards", stated: 6, extracted: 4 },
        { label: "Bells", stated: 19, extracted: 16 },
      ],
    };
    const d = build(facts);
    const missing = gate(d, PBZ).missing.filter((m) => m.startsWith("Extração incompleta"));
    expect(missing).toEqual([
      'Extração incompleta: PowerPyx (Crimson Forest) diz ter 6 "Sha-Chi Amber Shards" e a extração trouxe 4, mesmo relendo a página em partes; isso conta para "Complete Mastery" (ACH_043).',
    ]);
    expect(d.divergences.some((x) => x.includes('diz ter 19 "Bells"'))).toBe(true);
  });

  it("fonte secundária incompleta só vai para as divergências", () => {
    const g = { ...game8(), shortfall: { stated: 40, extracted: 10 } };
    const d = build([...powerpyx(), g]);
    expect(d.divergences.some((x) => x.startsWith("Extração incompleta: Game8"))).toBe(true);
    expect(gate(d, PBZ).missing.filter((m) => m.startsWith("Extração incompleta"))).toEqual([]);
  });

  it("extração suspeita (mais de 110% das entradas): os itens dela não fecham contagem", () => {
    const facts = powerpyx();
    facts.find((f) => f.source.name === "PowerPyx (Mandate Encampment)")!.suspect = { stated: 20, extracted: 27 };
    const d = build(facts);
    expect(achOf(d, "ACH_046").collect).toMatchObject({ counted: 40 });
    expect(d.divergences.some((x) => x.startsWith("Extração suspeita: PowerPyx (Mandate Encampment)"))).toBe(true);
  });
});

describe("contagem por tipo no relatório e na revisão da conquista", () => {
  it("collect.byType vai para o relatório (report.collectByType)", () => {
    const report = buildReport({ sourcesRead: [], dossier: build(powerpyx()), steamList: PBZ, spendUsd: 0 });
    expect(report.collectByType).toContainEqual({
      apiName: "ACH_046",
      name: "Collector’s Notes",
      target: 30,
      counted: 48,
      type: "Accessory",
      ambiguous: false,
      unconverted: 3,
    });
    expect(report.collectByType).toContainEqual(expect.objectContaining({ apiName: "ACH_044", ambiguous: true }));
  });

  it("a conquista contada por tipo sai com review true no guia", async () => {
    const { payload } = await writeGuideDetailed(fakeAi().ai, build(powerpyx()), GAME, "live");
    const items = payload.walkthrough.chapters.flatMap((c) => c.steps.flatMap((st) => st.items));
    expect(items.find((i) => i.achievement === "ACH_046")!.review).toBe(true);
  });
});
