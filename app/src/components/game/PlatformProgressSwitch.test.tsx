import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlatformProgressSwitch } from "./PlatformProgressSwitch";
import type { ProgressView } from "./progress-parts";

afterEach(cleanup);

const view = (over: Partial<ProgressView>): ProgressView => ({
  id: "steam",
  label: "Steam",
  color: "var(--pc)",
  unlocked: 10,
  total: 20,
  pct: 50,
  completed: false,
  badge: null,
  detail: "conquistas na Steam · 50% · faltam 10 para platinar",
  platLabel: "PLATINADO · 10/20",
  trophies: { platinum: "0/1", gold: "1", silver: "2", bronze: "7" },
  trophiesLabel: "Seus troféus na Steam, por nível",
  ...over,
});

const VIEWS = [
  view({ id: "todas", label: "Todas", color: null, unlocked: 30, total: 40, pct: 75, detail: "conquistas em 2 plataformas · 75% no total" }),
  view({}),
  view({
    id: "psn",
    label: "PSN",
    color: "var(--ps)",
    unlocked: 20,
    total: 20,
    pct: 100,
    completed: true,
    badge: "Platina",
    detail: "conquistas na PSN · 100% · platinado",
    trophies: { platinum: "1/1", gold: "3", silver: "6", bronze: "10" },
    trophiesLabel: "Seus troféus na PSN, por nível",
  }),
];

describe("PlatformProgressSwitch", () => {
  it("starts on the platform with the most progress and switches between platforms and Todas", async () => {
    render(<PlatformProgressSwitch views={VIEWS} initial="psn" hues={[0, 0]} seed={1} art={{ kind: "generated" }} name="Jogo" />);
    const group = screen.getByRole("group", { name: "Progresso por plataforma" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /PSN/ })).toBeChecked();
    expect(screen.getByText("conquistas na PSN · 100% · platinado")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Seus troféus na PSN, por nível" })).toBeInTheDocument();
    // Every option shows its own percentage or badge.
    expect(screen.getByRole("radio", { name: /Steam\s*50%/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /PSN\s*Platina/ })).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole("radio", { name: /Todas/ })));
    expect(screen.getByRole("radio", { name: /Todas/ })).toBeChecked();
    expect(screen.getByText("conquistas em 2 plataformas · 75% no total")).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole("radio", { name: /Steam/ })));
    expect(screen.getByRole("list", { name: "Seus troféus na Steam, por nível" })).toBeInTheDocument();
    expect(screen.getByText("conquistas na Steam · 50% · faltam 10 para platinar")).toBeInTheDocument();
  });
});
