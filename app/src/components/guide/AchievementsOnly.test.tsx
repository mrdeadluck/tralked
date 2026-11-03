import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AchievementsOnly } from "./AchievementsOnly";

vi.mock("./reveal-achievement", () => ({
  revealAchievement: vi.fn(async () => ({ name: "Segredo", description: "Surpresa" })),
}));

afterEach(cleanup);

const lists = [
  {
    platform: "steam" as const,
    achievements: [
      { id: "a1", name: "Visível", description: "Faça isso", iconUrl: null, globalPct: 40, hidden: false },
      { id: "h1", name: "", description: null, iconUrl: null, globalPct: 2, hidden: true },
    ],
  },
  { platform: "psn" as const, achievements: [{ id: "a2", name: "Troféu", description: null, iconUrl: null, globalPct: null, hidden: false }] },
];

describe("AchievementsOnly", () => {
  it("avisa que o jogo ainda não tem Guia Tralked", () => {
    render(<AchievementsOnly lists={lists} />);
    expect(screen.getByText(/ainda não tem Guia Tralked/)).toBeInTheDocument();
    expect(screen.getByText("Visível")).toBeInTheDocument();
  });

  it('ocultas ficam fora do DOM e só aparecem depois de "mostrar"', async () => {
    const { container } = render(<AchievementsOnly lists={lists} />);
    expect(screen.queryByText("Segredo")).toBeNull();
    expect(container).not.toHaveTextContent("Surpresa");
    expect(screen.getByText("Conquista oculta")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /mostrar/i }));
    expect(await screen.findByText("Segredo")).toBeInTheDocument();
    expect(screen.getByText("Surpresa")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mostrar/i })).toBeNull();
  });

  it("troca de aba mostra a lista da outra plataforma", () => {
    render(<AchievementsOnly lists={lists} />);
    fireEvent.click(screen.getByRole("button", { name: /psn/i }));
    expect(screen.getByText("Troféu")).toBeInTheDocument();
    expect(screen.queryByText("Visível")).toBeNull();
  });
});
