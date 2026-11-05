import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SetupStepper } from "@/components/onboarding/SetupStepper";
import { CatalogFilters } from "./CatalogFilters";

afterEach(cleanup);

const chip = (id: string, label = id) => ({ id, label, href: `/jogos?f=${id}` });
const GENRES = ["fps", "horror", "soulslike", "rpg", "roguelike", "plataforma", "estrategia", "simulacao", "puzzle", "coop"];

type Toggles = { exclusive?: boolean; trophies?: boolean };

function setup(current = "todos", platform = "todas", on: Toggles = {}) {
  return render(
    <CatalogFilters
      categories={{ options: [chip("todos"), chip("quase"), chip("guia"), ...GENRES.map((g) => chip(g))], current }}
      leading={3}
      platforms={{ options: [chip("todas"), chip("PC", "Steam / PC")], current: platform }}
      sorts={{ options: [chip("popular", "Popular"), chip("nome", "Nome")], current: "popular" }}
      toggles={{
        exclusive: on.exclusive ?? false,
        trophies: on.trophies ?? false,
        exclusiveHref: on.exclusive ? "/jogos?plataforma=PC" : "/jogos?plataforma=PC&exclusivos=1",
        trophiesHref: on.trophies ? "/jogos?plataforma=PC&exclusivos=1" : "/jogos?plataforma=PC&exclusivos=1&trofeus=1",
      }}
      activeCount={(current === "todos" ? 0 : 1) + (platform === "todas" ? 0 : 1) + (on.exclusive ? 1 : 0) + (on.trophies ? 1 : 0)}
      total={1234}
      clearHref="/jogos"
    />,
  );
}

describe("CatalogFilters", () => {
  // The first "Filtrar jogos" group is the wide-screen bar (the sheet has its own copy).
  const bar = () => within(screen.getAllByRole("group", { name: "Filtrar jogos" })[0]);

  it("shows six genres on the bar and the rest behind 'Mais gêneros'", () => {
    setup();
    expect(bar().getAllByRole("link")).toHaveLength(3 + 6);
    const more = screen.getByRole("button", { name: "Mais gêneros (4)" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(bar().getAllByRole("link")).toHaveLength(3 + 10);
    expect(screen.getByRole("button", { name: "Menos gêneros" })).toHaveAttribute("aria-expanded", "true");
  });

  it("never hides the selected genre", () => {
    setup("puzzle");
    expect(bar().getByRole("link", { name: "puzzle" })).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("button", { name: /Mais gêneros/ })).not.toBeInTheDocument();
  });

  it("phones: 'Filtrar (n)' counts the active filters and the sheet offers the results count", () => {
    setup("soulslike", "PC");
    expect(screen.getByRole("button", { name: "Filtrar (2)" })).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByText("soulslike · PC · Steam · Ordem: Popular")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver 1.234 jogos", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Limpar", hidden: true })).toHaveAttribute("href", "/jogos");
  });

  it("toggles keep the other params", () => {
    setup("todos", "PC", { exclusive: true });
    const group = within(screen.getAllByRole("group", { name: "Recortes do catálogo" })[0]);
    const exclusive = group.getByRole("button", { name: "Só exclusivos" });
    expect(exclusive).toHaveAttribute("aria-pressed", "true");
    expect(exclusive).toHaveAttribute("href", "/jogos?plataforma=PC");
    const trophies = group.getByRole("button", { name: "Só com troféus" });
    expect(trophies).toHaveAttribute("aria-pressed", "false");
    expect(trophies).toHaveAttribute("href", "/jogos?plataforma=PC&exclusivos=1&trofeus=1");
  });

  it("Só com troféus is disabled on Nintendo with a hint", () => {
    setup("todos", "NINTENDO", { exclusive: true });
    const group = within(screen.getAllByRole("group", { name: "Recortes do catálogo" })[0]);
    const trophies = group.getByRole("button", { name: "Só com troféus" });
    expect(trophies).toHaveAttribute("aria-disabled", "true");
    expect(trophies).not.toHaveAttribute("href");
    expect(screen.getAllByText("Jogos da Nintendo não têm troféus nem conquistas.").length).toBeGreaterThan(0);
    // Exclusive stays clickable.
    expect(group.getByRole("button", { name: "Só exclusivos" })).not.toHaveAttribute("aria-disabled");
  });

  it('PC label reads "PC · Steam"', () => {
    setup();
    expect(bar().queryByRole("link", { name: "Steam / PC" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "PC · Steam" }).length).toBeGreaterThan(0);
  });

  it("phones: the summary and the count include the toggles", () => {
    setup("todos", "PLAYSTATION", { exclusive: true, trophies: true });
    expect(screen.getByRole("button", { name: "Filtrar (3)" })).toBeInTheDocument();
    expect(screen.getByText(/Só exclusivos · Só com troféus · Ordem: Popular/)).toBeInTheDocument();
  });
});

describe("SetupStepper", () => {
  it("before connecting: the account is done and step 2 is current", () => {
    render(<SetupStepper connected={false} sheetHref="/jogador/ana" />);
    const steps = screen.getAllByRole("listitem");
    expect(steps[0]).toHaveTextContent("Conta criada (feito)");
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("after connecting: step 3 opens the sheet", () => {
    render(<SetupStepper connected sheetHref="/jogador/ana" />);
    expect(screen.getAllByRole("listitem")[2]).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("link", { name: /Veja o seu nível/ })).toHaveAttribute("href", "/jogador/ana");
  });
});
