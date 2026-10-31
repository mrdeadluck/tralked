import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsTab, WireItem } from "@/lib/queries/news";
import { NewsTabs } from "./NewsTabs";
import { NewsWire } from "./NewsWire";

let reduceMotion = false;

beforeEach(() => {
  reduceMotion = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("reduce") ? reduceMotion : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  // jsdom has no canvas: GameArt keeps its CSS gradient.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const items: WireItem[] = [
  { id: "a:1", href: "/noticias/um", variant: "paper", kicker: "Guias", title: "Rota do 100%", source: "Redação Tralked", when: "ontem", seed: 1 },
  {
    id: "block",
    href: "/noticias?categoria=guias",
    variant: "block",
    kicker: "Guias",
    title: "Guias da semana",
    source: "Redação Tralked",
    when: "esta semana",
    seed: 2,
    items: [{ label: "Hades", date: "30 out" }],
  },
  { id: "x:1", href: "https://example.com/n", external: true, variant: "newp", kicker: "Hollow Knight", title: "Recorde", source: "Fonte externa: Portal Exemplo", when: "há 3 dias", seed: 3, thin: "na////\nimprensa" },
  { id: "a:2", href: "/noticias/dois", variant: "portrait", kicker: "Comunidade", title: "Entrevista", source: "Redação Tralked", when: "há 4 dias", seed: 4, giant: "Hades" },
  { id: "a:3", href: "/noticias/tres", variant: "dark", kicker: "Games", title: "Patch", source: "Redação Tralked", when: "há 5 dias", seed: 5, imageUrl: "https://cdn.example.com/a.webp" },
];

describe("NewsWire", () => {
  it("renders every card once for assistive tech, the loop copy hidden and out of the tab order", () => {
    render(<NewsWire items={items} label="Notícias em movimento" />);
    const region = screen.getByRole("region", { name: "Notícias em movimento" });
    expect(region).toHaveAttribute("aria-roledescription", "carrossel");
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(items.length);
    const all = region.querySelectorAll("a");
    expect(all).toHaveLength(items.length * 3);
    const n = items.length;
    const copies = [...Array.from(all).slice(0, n), ...Array.from(all).slice(2 * n)];
    expect(Array.from(all).slice(n, 2 * n)).toEqual(links);
    expect(copies.every((a) => a.getAttribute("aria-hidden") === "true" && a.tabIndex === -1)).toBe(true);
  });

  it("labels external news and opens it safely in a new tab", () => {
    render(<NewsWire items={items} />);
    const external = screen.getByRole("link", { name: /^Recorde .*Hollow Knight, Fonte externa: Portal Exemplo, há 3 dias/ });
    expect(external).toHaveAttribute("href", "https://example.com/n");
    expect(external).toHaveAttribute("target", "_blank");
    expect(external).toHaveAttribute("rel", "noopener noreferrer");
    expect(external).toHaveAccessibleName(/abre em nova aba/);
    const editorial = screen.getByRole("link", { name: /Rota do 100%/ });
    expect(editorial).toHaveAttribute("href", "/noticias/um");
    expect(editorial).not.toHaveAttribute("target");
  });

  it("uses the real image when there is one and generated art otherwise", () => {
    const { container } = render(<NewsWire items={items} />);
    expect(container.querySelector('img[src="https://cdn.example.com/a.webp"]')).not.toBeNull();
    expect(container.querySelectorAll("canvas").length).toBeGreaterThan(0);
  });

  it("toggles pause, and starts paused with reduced motion", () => {
    render(<NewsWire items={items} />);
    const pause = screen.getByRole("button", { name: "Pausar notícias" });
    expect(pause).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(pause);
    expect(screen.getByRole("button", { name: "Retomar notícias" })).toHaveAttribute("aria-pressed", "true");
    cleanup();

    reduceMotion = true;
    render(<NewsWire items={items} />);
    expect(screen.getByRole("button", { name: "Retomar notícias" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Próxima notícia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notícia anterior" })).toBeInTheDocument();
  });

  it("never renders an unsafe href", () => {
    const { container } = render(
      <NewsWire
        items={[
          ...items,
          { ...items[2], id: "x:js", href: "javascript:alert(1)", title: "Inseguro js" },
          { ...items[2], id: "x:data", href: "data:text/html,<b>x</b>", title: "Inseguro data" },
          { ...items[0], id: "a:proto", href: "//evil.example.com", title: "Inseguro proto" },
        ]}
      />,
    );
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    expect(hrefs).toHaveLength(items.length * 3);
    expect(hrefs.some((h) => /^(javascript|data):|^\/\//i.test(h))).toBe(false);
    expect(screen.queryByText(/Inseguro/)).toBeNull();
  });

  it("renders nothing without items", () => {
    const { container } = render(<NewsWire items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

const story = (id: string, title: string) => ({
  id,
  href: `/noticias/${id}`,
  kicker: "Guias",
  title,
  excerpt: `Resumo de ${title}`,
  source: "@Rivia",
  when: "ontem",
  seed: 1,
});

const tabs: NewsTab[] = [
  { id: "ultimas", label: "Últimas", stories: [story("a", "Alfa"), story("b", "Beta"), story("c", "Gama")], moreHref: "/noticias" },
  { id: "guias", label: "Guias", stories: [story("d", "Delta")], moreHref: "/noticias?categoria=guias" },
  { id: "games", label: "Games", stories: [] },
];

describe("NewsTabs", () => {
  it("renders the magazine layout of the first tab with Mais lidas", () => {
    render(<NewsTabs tabs={tabs} mostRead={[story("m", "Mais lida")]} />);
    expect(screen.getByRole("tab", { name: "Últimas, 3 notícias" })).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", screen.getByRole("tab", { name: "Últimas, 3 notícias" }).id);
    expect(screen.getByRole("heading", { level: 3, name: "Alfa" })).toBeInTheDocument();
    expect(screen.getByText("Resumo de Alfa")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Mais lidas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mais lida" })).toHaveAttribute("href", "/noticias/m");
    expect(screen.getByRole("link", { name: "Ver todas →" })).toHaveAttribute("href", "/noticias");
  });

  it("switches tabs by click and arrow keys, with the panel swapped after the exit animation", () => {
    vi.useFakeTimers();
    try {
      render(<NewsTabs tabs={tabs} mostRead={[]} />);
      fireEvent.click(screen.getByRole("tab", { name: "Guias, 1 notícia" }));
      expect(screen.getByRole("tab", { name: "Guias, 1 notícia" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tabpanel")).toHaveAttribute("data-phase", "out");
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByRole("heading", { level: 3, name: "Delta" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Ver todas em Guias →" })).toBeInTheDocument();

      fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByRole("tab", { name: "Games, 0 notícias" })).toHaveFocus();
      expect(screen.getByText("Nenhuma notícia nesta categoria ainda.")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("swaps instantly with reduced motion", () => {
    reduceMotion = true;
    render(<NewsTabs tabs={tabs} mostRead={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Guias, 1 notícia" }));
    expect(screen.getByRole("tabpanel")).toHaveAttribute("data-phase", "in");
    expect(screen.getByRole("heading", { level: 3, name: "Delta" })).toBeInTheDocument();
  });

  it("drops stories with unsafe hrefs (javascript:, data:, protocol-relative)", () => {
    const unsafe = (id: string, href: string, external = true) => ({ ...story(id, `Inseguro ${id}`), href, external });
    const { container } = render(
      <NewsTabs
        tabs={[
          {
            id: "ultimas",
            label: "Últimas",
            stories: [
              unsafe("js", "javascript:alert(1)"),
              unsafe("data", "data:text/html,<b>x</b>"),
              unsafe("proto", "//evil.example.com", false),
              story("ok", "Segura"),
            ],
          },
        ]}
        mostRead={[unsafe("mr", "javascript:alert(2)"), story("mr-ok", "Lida")]}
      />,
    );
    expect(screen.getByRole("tab", { name: "Últimas, 1 notícia" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Segura" })).toBeInTheDocument();
    expect(screen.queryByText(/Inseguro/)).toBeNull();
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => /^(javascript|data):|^\/\//i.test(h))).toBe(false);
  });
});
