import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LibraryGame } from "@/lib/library/queries";
import { libraryVersions, type ListProgress, type PlatformProgressRow } from "@/lib/library/versions";
import { LibraryCoverGrid } from "./LibraryCoverGrid";

afterEach(cleanup);

const at = (d: number) => new Date(Date.UTC(2024, 0, d));
const list = (console: string, externalId: string, over: Partial<ListProgress> = {}): ListProgress => ({
  platform: "psn",
  console,
  externalId,
  unlockedCount: 10,
  completedAt: null,
  total: 50,
  platinumEarned: false,
  ...over,
});
const platform = (p: PlatformProgressRow["platform"], unlockedCount: number, achievementTotal: number, completedAt: Date | null = null) => ({
  platform: p,
  unlockedCount,
  achievementTotal,
  completedAt,
});

function game(platforms: PlatformProgressRow[], lists: ListProgress[]): LibraryGame {
  return {
    gameId: "g1",
    slug: "grand-theft-auto-v",
    name: "Grand Theft Auto V",
    coverUrl: null,
    steamAppId: 271590,
    portraitChecked: true,
    stub: false,
    platforms: platforms.map((p) => ({ ...p, playtimeMin: 60 * 100, playtime2WeeksMin: null, lastPlayedAt: null })),
    playtimeMin: 60 * 412,
    lastPlayedAt: null,
    unlockedCount: 0,
    achievementTotal: 0,
    completionPct: null,
    played: true,
    completed: false,
    versions: libraryVersions(platforms, lists),
  };
}

const badges = (container: HTMLElement) =>
  [...container.querySelectorAll(".lcg-vb")].map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim());

// GTA V as the approved mockup: PS5 platinum in two regions, PS4 platinum, PS3 34%, Steam 64%.
const GTA = game(
  [platform("psn", 120, 400, at(9)), platform("steam", 49, 77)],
  [
    list("PS5", "NPWR22807_00", { unlockedCount: 50, completedAt: at(3), platinumEarned: true }),
    list("PS5", "NPWR22808_00", { unlockedCount: 50, completedAt: at(5), platinumEarned: true }),
    list("PS4", "NPWR06221_00", { unlockedCount: 49, total: 50, platinumEarned: true }),
    list("PS3", "NPWR04812_00", { unlockedCount: 17, total: 50 }),
  ],
);

describe("LibraryCoverGrid", () => {
  it("badge PS5 ✓² for a platinum in two regions", () => {
    const { container } = render(<LibraryCoverGrid games={[GTA]} />);
    expect(badges(container)).toEqual(["PS5 ✓2", "PS4 ✓", "PS3 34%", "PC 64%"]);
    const ps5 = container.querySelector(".lcg-vb")!;
    expect(ps5.querySelector("sup")).toHaveTextContent("2");
    expect(ps5).toHaveAttribute("title", "PS5: platina em 2 listas regionais");
    // Each game once, linked to its page, with its versions for screen readers.
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/jogos/grand-theft-auto-v");
    expect(link).toHaveTextContent("4 versões · 412 h");
    expect(link).toHaveTextContent("Versões: PS5: platina em 2 listas regionais; PS4: platina; PS3: 34%; PC: 64%.");
  });

  it("PC 64% for a Steam version", () => {
    const { container } = render(<LibraryCoverGrid games={[game([platform("steam", 49, 77)], [])]} />);
    expect(badges(container)).toEqual(["PC 64%"]);
    expect(container.querySelector(".lcg-vb sup")).toBeNull();
    expect(screen.getByRole("link")).toHaveTextContent("1 versão");
  });

  it("a PS5 platinum in one region plus 3% in another reads PS5 ✓, no superscript", () => {
    const g = game(
      [platform("psn", 52, 100)],
      [
        list("PS5", "NPWR22807_00", { unlockedCount: 50, completedAt: at(3), platinumEarned: true }),
        list("PS5", "NPWR22808_00", { unlockedCount: 2, total: 50 }),
      ],
    );
    const { container } = render(<LibraryCoverGrid games={[g]} />);
    expect(badges(container)).toEqual(["PS5 ✓"]);
    expect(container.querySelector(".lcg-vb sup")).toBeNull();
    expect(container.querySelector(".lcg-vb")).toHaveAttribute("title", "PS5: platina");
    expect(screen.getByRole("link")).toHaveTextContent("Versões: PS5: platina.");
  });

  it("Xbox reads Xbox, Xbox PC or 360, RA its console, and a region that was only opened does not count", () => {
    const g = game(
      [platform("xbox", 0, 0), platform("retro", 0, 0)],
      [
        { ...list("ONE", "1717113201", { unlockedCount: 6, total: 50 }), platform: "xbox" },
        { ...list("PC", "1800000000", { unlockedCount: 10, total: 50 }), platform: "xbox" },
        { ...list("360", "1414793383", { unlockedCount: 35, total: 50 }), platform: "xbox" },
        { ...list("SNES/Super Famicom", "228", { unlockedCount: 20, total: 50 }), platform: "retro" },
        list("PS5", "NPWR1", { unlockedCount: 20, total: 40 }),
        list("PS5", "NPWR2", { unlockedCount: 0, total: 40 }),
      ],
    );
    const { container } = render(<LibraryCoverGrid games={[g]} />);
    expect(badges(container)).toEqual(["PS5 50%", "360 70%", "Xbox 12%", "Xbox PC 20%", "SNES 40%"]);
    expect(screen.getByRole("link")).toHaveTextContent("Versões: PS5: 50%; 360: 70%; Xbox: 12%; Xbox PC: 20%; SNES: 40%.");
  });
});
