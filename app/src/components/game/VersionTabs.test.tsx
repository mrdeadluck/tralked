import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameVersion, PlayerVersion, VersionTrophy } from "@/lib/queries/game-versions";
import { FIRST_ROWS, publicTrophies, versionMarks, versionTabs, type TabsMarks, type VersionTabTrophy } from "./version-views";
import { VersionTabs } from "./VersionTabs";

afterEach(cleanup);

const trophy = (apiName: string, name: string, over: Partial<VersionTrophy> = {}): VersionTrophy => ({
  apiName,
  name,
  description: `Descrição de ${name}`,
  iconUrl: null,
  tier: "bronze",
  globalPct: 40,
  hidden: false,
  ...over,
});
const version = (key: string, label: string, platform: GameVersion["platform"], trophies: VersionTrophy[], over: Partial<GameVersion> = {}): GameVersion => ({
  key,
  platform,
  label,
  total: trophies.length,
  tiers: { platinum: 1, gold: 0, silver: 0, bronze: trophies.length - 1 },
  nativePlatinum: platform === "psn",
  lists: [{ id: `${key}-1`, label: null, trophyCount: trophies.length }],
  trophies,
  ...over,
});

// PS5: platinum, two named trophies, a hidden one, then filler past the first rows ("Extra 20" is #21).
const PS5_TROPHIES = [
  trophy("0", "Platina", { tier: "platinum", globalPct: 4.1 }),
  trophy("1", "Bem-vindo a Los Santos"),
  trophy("2", "Segredo", { hidden: true }),
  ...Array.from({ length: 20 }, (_, i) => trophy(String(i + 3), `Extra ${i + 3}`)),
];
const PS5 = version("psn:PS5", "PS5", "psn", PS5_TROPHIES, {
  lists: [
    { id: "a", label: "Lista 1", trophyCount: 23 },
    { id: "b", label: "🇯🇵 Ásia", trophyCount: 23 },
  ],
});
const PS4 = version("psn:PS4", "PS4", "psn", [trophy("0", "Platina do PS4", { tier: "platinum" }), trophy("1", "Três contra todos")]);
const XBOX = version("xbox:1", "Xbox One/Series", "xbox", [trophy("1", "Kifflom!", { globalPct: 9.7 })], { nativePlatinum: false });
const VERSIONS = [PS5, PS4, XBOX];

const at = (d: number) => new Date(Date.UTC(2022, 3, d, 15));
const MINE: PlayerVersion = {
  key: "psn:PS5",
  label: "PS5",
  platform: "psn",
  nativePlatinum: true,
  unlocked: 4,
  total: 23,
  pct: 17,
  platinum: true,
  lists: [
    { id: "a", label: "Lista 1", complete: false, unlocked: 4 },
    { id: "b", label: "🇯🇵 Ásia", complete: false, unlocked: 2 },
  ],
  countedNote: "2 listas · conta 1",
  earnedIn: { "0": ["Lista 1", "🇯🇵 Ásia"], "1": ["Lista 1", "🇯🇵 Ásia"], "2": ["Lista 1"], "20": ["Lista 1"] },
  bestListId: "a",
  unlockedAt: { "0": at(14), "1": at(2), "2": at(3), "20": at(25) },
  tiersEarned: { platinum: 1, gold: 0, silver: 0, bronze: 3 },
  earnedAt: {
    "0": [
      { label: "Lista 1", at: at(14) },
      { label: "🇯🇵 Ásia", at: at(20) },
    ],
    "1": [
      { label: "Lista 1", at: at(2) },
      { label: "🇯🇵 Ásia", at: at(21) },
    ],
  },
  xp: { "0": 2400 },
};

const noMore = vi.fn(async () => null);
/** The action's answer: a version's whole public list (from a snapshot of the versions). */
const fullOf = (versions: GameVersion[]) => async (key: string) => {
  const v = versions.find((x) => x.key === key);
  return v ? publicTrophies(v) : null;
};
const props = { label: "Versões de GTA V", title: "Troféus e conquistas", aside: null };

async function show(marks: TabsMarks | null, loadMore: (key: string) => Promise<VersionTabTrophy[] | null> = noMore) {
  await act(async () => {
    render(<VersionTabs {...props} tabs={versionTabs(VERSIONS)} marks={Promise.resolve(marks)} loadMore={loadMore} />);
  });
}

describe("versionTabs (the public part, once in the page)", () => {
  it("the visitor payload holds at most FIRST_ROWS rows per tab, hidden ones masked", () => {
    const tabs = versionTabs(VERSIONS);
    expect(tabs.map((t) => [t.key, t.trophies.length, t.count])).toEqual([
      ["psn:PS5", FIRST_ROWS, 23],
      ["psn:PS4", 2, 2],
      ["xbox:1", 1, 1],
    ]);
    const payload = JSON.stringify(tabs);
    expect(payload).not.toContain("Extra 20");
    expect(payload).not.toContain("Segredo");
    expect(publicTrophies(PS5).map((t) => t.apiName)).toEqual(PS5_TROPHIES.map((t) => t.apiName));
  });
});

describe("VersionTabs", () => {
  it("VersionTabs switches the trophy list with arrow keys", async () => {
    await show(null);
    const list = screen.getByRole("tablist", { name: "Versões de GTA V" });
    const [ps5, ps4, xbox] = within(list).getAllByRole("tab");
    expect(ps5).toHaveAttribute("aria-selected", "true");
    expect(ps4).toHaveAttribute("tabindex", "-1");
    expect(xbox).toHaveTextContent("Xbox (Xbox One/Series)");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Bem-vindo a Los Santos");

    await act(async () => fireEvent.keyDown(ps5, { key: "ArrowRight" }));
    expect(ps4).toHaveAttribute("aria-selected", "true");
    expect(ps4).toHaveFocus();
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", ps4.id);
    expect(panel).toHaveTextContent("Três contra todos");
    expect(panel).not.toHaveTextContent("Bem-vindo a Los Santos");

    await act(async () => fireEvent.keyDown(ps4, { key: "End" }));
    expect(xbox).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Kifflom!");
    await act(async () => fireEvent.keyDown(xbox, { key: "ArrowRight" }));
    expect(ps5).toHaveAttribute("aria-selected", "true");
    await act(async () => fireEvent.keyDown(ps5, { key: "ArrowLeft" }));
    expect(xbox).toHaveAttribute("aria-selected", "true");
    await act(async () => fireEvent.keyDown(xbox, { key: "Home" }));
    expect(ps5).toHaveAttribute("aria-selected", "true");

    // A visitor sees no marks, and a hidden trophy keeps its text to itself.
    expect(screen.getByRole("tabpanel")).not.toHaveTextContent("XP");
    expect(screen.getByRole("tabpanel")).not.toHaveTextContent("não obtido");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Troféu oculto");
  });

  it('"Ver a lista inteira" loads the rest, and the player\'s marks apply to the rows loaded later', async () => {
    const loadMore = vi.fn(fullOf(VERSIONS));
    await show(versionMarks(VERSIONS, [MINE]), loadMore);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getAllByRole("listitem")).toHaveLength(FIRST_ROWS);
    expect(panel).toHaveTextContent(`Mostrando ${FIRST_ROWS} de 23`);

    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Ver a lista inteira" })));
    expect(loadMore).toHaveBeenCalledWith("psn:PS5");
    expect(within(panel).getAllByRole("listitem")).toHaveLength(23);
    const late = within(panel).getByRole("heading", { name: "Extra 20" }).closest("li")!;
    expect(late).toHaveTextContent("25/04/2022");
    expect(within(panel).getByRole("heading", { name: "Extra 21" }).closest("li")).toHaveTextContent("não obtido");

    expect(panel).toHaveTextContent("Mostrando 23 de 23");
    // Closing and opening again does not read the list twice.
    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Mostrar menos" })));
    expect(within(panel).getAllByRole("listitem")).toHaveLength(FIRST_ROWS);
    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Ver a lista inteira" })));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("a list read later in another order replaces the first rows: no duplicate, no missing trophy", async () => {
    // Between the page and the click a sync reordered the list (Steam reorders by rarity).
    const later = [{ ...PS5, trophies: [...PS5_TROPHIES].reverse() }, PS4, XBOX];
    await show(null, fullOf(later));
    const panel = screen.getByRole("tabpanel");
    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Ver a lista inteira" })));
    const names = within(panel).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(names).toHaveLength(23);
    expect(new Set(names).size).toBe(23);
    expect(names[0]).toBe("Extra 22");
    expect(panel).toHaveTextContent("Mostrando 23 de 23");
  });

  it("a player's tab opens on the disc's version and marks where each trophy was earned", async () => {
    // The player has PS4 too (incomplete): the disc's version (PS5, platinum) is the one opened.
    const ps4: PlayerVersion = {
      ...MINE,
      key: "psn:PS4",
      label: "PS4",
      platinum: false,
      pct: 50,
      unlocked: 1,
      total: 2,
      lists: [],
      earnedIn: {},
      earnedAt: {},
      unlockedAt: { "1": at(1) },
      xp: {},
    };
    await show(versionMarks(VERSIONS, [ps4, MINE]));
    expect(screen.getByRole("tab", { name: /PS5/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /PS5/ })).toHaveTextContent(/platina/i);
    expect(screen.getByRole("tab", { name: /PS4/ })).toHaveTextContent("1/2");
    expect(screen.getByText("Uma aba por versão · as suas marcas em cada uma")).toBeInTheDocument();
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent("4 de 23 troféus no PS5");
    const plat = within(panel).getByRole("heading", { name: "Platina" }).closest("li")!;
    expect(plat).toHaveTextContent("14/04/2022");
    expect(plat).toHaveTextContent("+2.400 XP");
    expect(plat).toHaveTextContent("Obtido na Lista 1 em 14/04/2022 e na 🇯🇵 Ásia em 20/04/2022.");
    // The XP note is said once per panel; the other rows keep each list's date in the chip.
    const second = within(panel).getByRole("heading", { name: "Bem-vindo a Los Santos" }).closest("li")!;
    expect(second).not.toHaveTextContent("O XP veio");
    expect(within(second).getByText("🇯🇵 Ásia").closest("[title]")).toHaveAttribute("title", "Obtido em 21/04/2022");
    // An earned hidden trophy shows its name to the one who earned it.
    expect(panel).toHaveTextContent("Segredo");
    // A version the player does not have: the list without marks.
    await act(async () => fireEvent.click(screen.getByRole("tab", { name: /Xbox/ })));
    expect(screen.getByRole("tabpanel")).not.toHaveTextContent("não obtida");
  });
});
