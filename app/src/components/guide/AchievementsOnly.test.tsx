import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AchievementsOnly } from "./AchievementsOnly";

afterEach(cleanup);

const lists = [
  {
    platform: "steam" as const,
    achievements: [
      { name: "Visível", description: "Faça isso", iconUrl: null, globalPct: 40, hidden: false },
      { name: "Segredo", description: "Surpresa", iconUrl: null, globalPct: 2, hidden: true },
    ],
  },
  { platform: "psn" as const, achievements: [{ name: "Troféu", description: null, iconUrl: null, globalPct: null, hidden: false }] },
];

describe("AchievementsOnly", () => {
  it("avisa que o jogo ainda não tem Guia Tralked", () => {
    render(<AchievementsOnly lists={lists} />);
    expect(screen.getByText(/ainda não tem Guia Tralked/)).toBeInTheDocument();
    expect(screen.getByText("Visível")).toBeInTheDocument();
  });

  it('ocultas aparecem borradas com "mostrar"', () => {
    render(<AchievementsOnly lists={lists} />);
    const hidden = screen.getByText("Segredo").closest("[data-hidden]");
    expect(hidden).toHaveAttribute("data-hidden", "true");
    expect(screen.getByText("Segredo").closest("div")).toHaveClass("blur-[6px]");
    fireEvent.click(screen.getByRole("button", { name: /mostrar/i }));
    expect(screen.getByText("Segredo").closest("[data-hidden]")).toHaveAttribute("data-hidden", "false");
    expect(screen.queryByRole("button", { name: /mostrar/i })).toBeNull();
  });

  it("troca de aba mostra a lista da outra plataforma", () => {
    render(<AchievementsOnly lists={lists} />);
    fireEvent.click(screen.getByRole("button", { name: /psn/i }));
    expect(screen.getByText("Troféu")).toBeInTheDocument();
    expect(screen.queryByText("Visível")).toBeNull();
  });
});
