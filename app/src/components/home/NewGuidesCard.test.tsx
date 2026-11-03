import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HomeGuideView } from "@/lib/queries/home-guides";
import { NewGuidesCard } from "./NewGuidesCard";

const now = new Date("2026-11-03T15:00:00Z");
const HOUR = 3_600_000;

const guide = (over: Partial<HomeGuideView>): HomeGuideView => ({
  id: "g1",
  slug: "hollow-knight",
  name: "Hollow Knight",
  coverUrl: "https://cdn.example.com/hk.jpg",
  heroUrl: null,
  steamAppId: 367520,
  portraitChecked: true,
  href: "/jogos/hollow-knight/guia",
  kind: "walkthrough",
  line: "Detonado completo · 20 capítulos · 36 troféus PSN",
  seals: ["psn"],
  publishedAt: new Date(now.getTime() - 2 * HOUR),
  ...over,
});

const guides = [
  guide({}),
  guide({
    id: "g2",
    slug: "hades",
    name: "Hades",
    href: "/jogos/hades/guia",
    kind: "classic",
    line: "Guia 100% · 49 conquistas Steam",
    seals: ["steam", "xbox"],
    publishedAt: new Date(now.getTime() - 10 * 24 * HOUR),
  }),
];

describe("NewGuidesCard", () => {
  it("links each guide with its line, seals, date and the 'novo' badge only in its first 7 days", () => {
    const { container } = render(<NewGuidesCard guides={guides} now={now} />);
    const section = within(container).getByRole("region", { name: "Novos guias" });
    expect(within(section).getByRole("heading", { name: "Novos guias" })).toBeInTheDocument();

    const [hk, hades] = within(section).getAllByRole("listitem");
    const hkLink = within(hk).getByRole("link");
    expect(hkLink).toHaveAttribute("href", "/jogos/hollow-knight/guia");
    expect(hkLink).toHaveTextContent("Hollow Knight");
    expect(hkLink).toHaveTextContent("Detonado completo · 20 capítulos · 36 troféus PSN");
    expect(within(hk).getByText("Novo")).toBeInTheDocument();
    expect(within(hk).getByText("PSN")).toBeInTheDocument();
    expect(within(hk).getByText("há 2 horas").closest("time")).toHaveAttribute("dateTime", "2026-11-03T13:00:00.000Z");

    expect(within(hades).getByRole("link")).toHaveAttribute("href", "/jogos/hades/guia");
    expect(within(hades).getByText("Guia 100% · 49 conquistas Steam")).toBeInTheDocument();
    expect(within(hades).queryByText("Novo")).toBeNull();
    expect(within(hades).getByText("Steam")).toBeInTheDocument();
    expect(within(hades).getByText("Xbox")).toBeInTheDocument();
    expect(within(hades).getByText("há 10 dias")).toBeInTheDocument();
  });

  it("ends with a link to every game with a guide", () => {
    const { container } = render(<NewGuidesCard guides={guides} now={now} />);
    expect(within(container).getByRole("link", { name: "Todos os guias →" })).toHaveAttribute("href", "/jogos?guia=1");
  });

  it("renders nothing without published guides", () => {
    const { container } = render(<NewGuidesCard guides={[]} now={now} />);
    expect(container).toBeEmptyDOMElement();
  });
});
