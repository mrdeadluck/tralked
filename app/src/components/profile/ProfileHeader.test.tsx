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
  tralked: 571,
  platinums: 520,
  psnPlatinums: 520,
  platforms: [{ platform: "psn", handle: "diguzz", verified: true }],
  backdropUrls: [],
};

const cell = (strip: HTMLElement, label: string) => within(strip).getByText(label, { selector: "dt" }).parentElement!;

describe("ProfileHeader", () => {
  it("header shows Tralked first as the main counter, then Platinas, and no regional-lists counter", () => {
    render(<ProfileHeader summary={SUMMARY} section="Jogos" />);
    const strip = screen.getByRole("group", { name: "Números do perfil" });
    expect(within(strip).getAllByRole("term").map((t) => t.textContent)).toEqual(["Tralked", "Platinas", "Jogos"]);
    expect(cell(strip, "Tralked")).toHaveTextContent("571");
    expect(cell(strip, "Tralked")).toHaveTextContent("jogos 100% em qualquer plataforma");
    expect(within(cell(strip, "Tralked")).getByText("571")).toHaveClass("text-acc");
    expect(cell(strip, "Platinas")).toHaveTextContent("520");
    expect(cell(strip, "Platinas")).toHaveTextContent("troféus de platina da PSN");
    expect(within(cell(strip, "Platinas")).getByText("520")).not.toHaveClass("text-acc");
    expect(within(strip).queryByText(/Listas regionais/)).toBeNull();
    expect(within(strip).queryByText(/contam no XP/)).toBeNull();
    expect(cell(strip, "Jogos")).toHaveTextContent("2.148");
    // "Nível" lives in the level box only.
    expect(within(strip).queryByText("Nível")).toBeNull();
    expect(within(strip).getAllByRole("term")).toHaveLength(3);
  });

  it("without PSN the Platinas counter is hidden and Tralked stays", () => {
    render(<ProfileHeader summary={{ ...SUMMARY, tralked: 12, platinums: 0, psnPlatinums: 0, platforms: [] }} section="Jogos" />);
    const strip = screen.getByRole("group", { name: "Números do perfil" });
    expect(within(strip).queryByText("Platinas")).toBeNull();
    expect(cell(strip, "Tralked")).toHaveTextContent("12");
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
      "Tralked",
      "Platinas",
      "Jogos",
      "Conquistas",
    ]);
  });
});
