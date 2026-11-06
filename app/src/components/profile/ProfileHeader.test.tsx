import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ProfileSummary } from "@/lib/profile/queries";
import { ProfileHeader } from "./ProfileHeader";

afterEach(cleanup);

const SUMMARY: ProfileSummary = {
  userId: "u1",
  handle: "diguzz",
  displayName: "diguzz",
  avatarUrl: null,
  level: 197,
  vocation: "Caçador de platinas",
  totalXp: 124_600_000,
  playtimeMin: 18_420 * 60,
  gamesCount: 2148,
  achievements: 61_904,
  wishlist: 38,
  platinums: 571,
  psnPlatinums: 520,
  platforms: [{ platform: "psn", handle: "diguzz", verified: true }],
  backdropUrls: [],
};

const cell = (strip: HTMLElement, label: string) => within(strip).getByText(label, { selector: "dt" }).parentElement!;

describe("ProfileHeader", () => {
  it("header shows Platinas with the PSN part under it, and no regional-lists counter", () => {
    render(<ProfileHeader summary={SUMMARY} section="Jogos" />);
    const strip = screen.getByRole("group", { name: "Números do perfil" });
    expect(cell(strip, "Platinas")).toHaveTextContent("571");
    expect(cell(strip, "Platinas")).toHaveTextContent("520 na PSN");
    expect(within(strip).queryByText(/Listas regionais/)).toBeNull();
    expect(within(strip).queryByText(/contam no XP/)).toBeNull();
    expect(cell(strip, "Jogos")).toHaveTextContent("2.148");
    // "Nível" lives in the level box only.
    expect(within(strip).queryByText("Nível")).toBeNull();
    expect(within(strip).getAllByRole("term")).toHaveLength(2);
  });

  it("without PSN the Platinas cell has no PSN note", () => {
    render(<ProfileHeader summary={{ ...SUMMARY, platinums: 12, psnPlatinums: 0, platforms: [] }} section="Jogos" />);
    const strip = screen.getByRole("group", { name: "Números do perfil" });
    expect(cell(strip, "Platinas")).toHaveTextContent("12");
    expect(cell(strip, "Platinas")).not.toHaveTextContent("na PSN");
  });

  it("the Ficha keeps its own numbers after the shared two", () => {
    render(
      <ProfileHeader
        summary={SUMMARY}
        section="Ficha"
        stats={[{ label: "Conquistas", value: "61.904", note: "todas as plataformas" }]}
      />,
    );
    const strip = screen.getByRole("group", { name: "Números do perfil" });
    expect(within(strip).getAllByRole("term").map((t) => t.textContent)).toEqual([
      "Platinas",
      "Jogos",
      "Conquistas",
    ]);
  });
});
