import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GameVersion, PlayerVersion, VersionTrophy } from "@/lib/queries/game-versions";
import { versionTabs } from "./version-views";
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

const PS5 = version(
  "psn:PS5",
  "PS5",
  "psn",
  [trophy("0", "Platina", { tier: "platinum", globalPct: 4.1 }), trophy("1", "Bem-vindo a Los Santos"), trophy("2", "Segredo", { hidden: true })],
  {
    lists: [
      { id: "a", label: "Lista 1", trophyCount: 3 },
      { id: "b", label: "🇯🇵 Ásia", trophyCount: 3 },
    ],
  },
);
const PS4 = version("psn:PS4", "PS4", "psn", [trophy("0", "Platina do PS4", { tier: "platinum" }), trophy("1", "Três contra todos")]);
const STEAM = version("steam", "PC · Steam", "steam", [trophy("A", "Kifflom!", { globalPct: 9.7 })], { nativePlatinum: false, lists: [] });

const at = (d: number) => new Date(Date.UTC(2022, 3, d, 15));
const MINE: PlayerVersion = {
  key: "psn:PS5",
  label: "PS5",
  platform: "psn",
  nativePlatinum: true,
  unlocked: 3,
  total: 3,
  pct: 100,
  platinum: true,
  lists: [
    { id: "a", label: "Lista 1", complete: true, unlocked: 3 },
    { id: "b", label: "🇯🇵 Ásia", complete: false, unlocked: 1 },
  ],
  countedNote: "2 listas · conta 1",
  earnedIn: { "0": ["Lista 1", "🇯🇵 Ásia"], "1": ["Lista 1", "🇯🇵 Ásia"], "2": ["Lista 1"] },
  bestListId: "a",
  unlockedAt: { "0": at(14), "1": at(2), "2": at(3) },
  tiersEarned: { platinum: 1, gold: 0, silver: 0, bronze: 2 },
  earnedAt: {
    "0": [
      { label: "Lista 1", at: at(14) },
      { label: "🇯🇵 Ásia", at: at(20) },
    ],
    "1": [
      { label: "Lista 1", at: at(2) },
      { label: "🇯🇵 Ásia", at: at(21) },
    ],
    "2": [{ label: "Lista 1", at: at(3) }],
  },
  xp: { "0": 2400 },
};

describe("VersionTabs", () => {
  it("VersionTabs switches the trophy list with arrow keys", async () => {
    const { tabs, initial } = versionTabs([STEAM, PS5, PS4], null);
    render(<VersionTabs tabs={tabs} initial={initial} label="Versões de GTA V" title="Troféus e conquistas" aside={null} />);
    const list = screen.getByRole("tablist", { name: "Versões de GTA V" });
    const [steam, ps5, ps4] = within(list).getAllByRole("tab");
    expect(steam).toHaveAttribute("aria-selected", "true");
    expect(ps5).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Kifflom!");

    await act(async () => fireEvent.keyDown(steam, { key: "ArrowRight" }));
    expect(ps5).toHaveAttribute("aria-selected", "true");
    expect(ps5).toHaveFocus();
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", ps5.id);
    expect(panel).toHaveTextContent("Bem-vindo a Los Santos");
    expect(panel).not.toHaveTextContent("Kifflom!");

    await act(async () => fireEvent.keyDown(ps5, { key: "End" }));
    expect(ps4).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Três contra todos");
    await act(async () => fireEvent.keyDown(ps4, { key: "ArrowRight" }));
    expect(steam).toHaveAttribute("aria-selected", "true");
    await act(async () => fireEvent.keyDown(steam, { key: "ArrowLeft" }));
    expect(ps4).toHaveAttribute("aria-selected", "true");
    await act(async () => fireEvent.keyDown(ps4, { key: "Home" }));
    expect(steam).toHaveAttribute("aria-selected", "true");

    // A visitor sees no marks, and a hidden trophy keeps its text to itself.
    await act(async () => fireEvent.click(ps5));
    expect(screen.getByRole("tabpanel")).not.toHaveTextContent("XP");
    expect(screen.getByRole("tabpanel")).not.toHaveTextContent("Segredo");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Troféu oculto");
  });

  it("a player's tab opens on the disc's version and marks where each trophy was earned", () => {
    const { tabs, initial } = versionTabs([STEAM, PS5, PS4], [MINE]);
    render(<VersionTabs tabs={tabs} initial={initial} label="Versões" title="Troféus e conquistas" aside={null} />);
    expect(screen.getByRole("tab", { name: /PS5/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /PS5/ })).toHaveTextContent(/platina/i);
    const panel = screen.getByRole("tabpanel");
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
    // Another version the player does not have: the list without marks.
    fireEvent.click(screen.getByRole("tab", { name: /PS4/ }));
    expect(screen.getByRole("tabpanel")).not.toHaveTextContent("não obtido");
  });
});
