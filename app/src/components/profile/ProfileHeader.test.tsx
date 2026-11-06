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
  platinums: 504,
  regionalExtras: 67,
  platforms: [],
  backdropUrls: [],
};

const cell = (strip: HTMLElement, label: string) => within(strip).getByText(label, { selector: "dt" }).parentElement!;

describe("ProfileHeader", () => {
  it("header shows Platinas (contam no XP) and Listas regionais extras", () => {
    render(<ProfileHeader summary={SUMMARY} section="Jogos" />);
    const strip = screen.getByRole("group", { name: "Números do perfil" });
    expect(cell(strip, "Platinas (contam no XP)")).toHaveTextContent("504");
    expect(cell(strip, "Platinas (contam no XP)")).toHaveTextContent("uma por versão");
    expect(cell(strip, "Listas regionais extras")).toHaveTextContent("67");
    expect(cell(strip, "Listas regionais extras")).toHaveTextContent("aparecem, mas não somam XP");
    expect(cell(strip, "Jogos")).toHaveTextContent("2.148");
    // "Nível" lives in the level box only.
    expect(within(strip).queryByText("Nível")).toBeNull();
    expect(within(strip).getAllByRole("term")).toHaveLength(3);
  });

  it("the Ficha keeps its own numbers after the shared three", () => {
    render(
      <ProfileHeader
        summary={SUMMARY}
        section="Ficha"
        stats={[{ label: "Conquistas", value: "61.904", note: "todas as plataformas" }]}
      />,
    );
    const strip = screen.getByRole("group", { name: "Números do perfil" });
    expect(within(strip).getAllByRole("term").map((t) => t.textContent)).toEqual([
      "Platinas (contam no XP)",
      "Listas regionais extras",
      "Jogos",
      "Conquistas",
    ]);
  });
});
