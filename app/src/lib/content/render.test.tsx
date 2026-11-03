import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { achievementKey, Blocks, inlineMarkup } from "./render";
import { contentBlocksSchema, type ContentBlock } from "./schema";

afterEach(cleanup);

const html = (node: React.ReactNode) => render(<p>{node}</p>).container.firstElementChild!.innerHTML;

describe("inlineMarkup", () => {
  it("renders bold, italic and http(s) links", () => {
    expect(html(inlineMarkup("a **b** *c* [d](https://example.com/x)"))).toBe(
      'a <strong class="font-bold text-text">b</strong> <em>c</em> ' +
        '<a href="https://example.com/x" target="_blank" rel="noopener noreferrer" ' +
        'class="text-acc underline decoration-1 underline-offset-[3px] hover:decoration-2">d</a>',
    );
  });

  it("nests markup inside links and bold", () => {
    render(<p>{inlineMarkup("**forte [link *x*](https://example.com)**")}</p>);
    const link = screen.getByRole("link", { name: "link x" });
    expect(link.closest("strong")).not.toBeNull();
    expect(link.querySelector("em")?.textContent).toBe("x");
  });

  it("keeps HTML and unsafe links as literal text", () => {
    const { container } = render(
      <p>{inlineMarkup('<img src=x onerror="alert(1)"> [clique](javascript:alert(1))')}</p>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror="alert(1)"> clique)');
  });

  it("||spoiler|| is literal text unless the caller handles spoilers", () => {
    expect(html(inlineMarkup("a ||b|| c"))).toBe("a ||b|| c");
    expect(html(inlineMarkup("a ||**b**|| c", { spoiler: (inner) => <mark>{inner}</mark> }))).toBe("a <mark>**b**</mark> c");
    // Inside bold too; an unclosed || stays literal.
    expect(html(inlineMarkup("**x ||y||** ||z", { spoiler: () => <i>?</i> }))).toBe(
      '<strong class="font-bold text-text">x <i>?</i></strong> ||z',
    );
  });

  it("leaves unmatched asterisks alone", () => {
    expect(html(inlineMarkup("2 * 3 = 6 e **sem fim"))).toBe("2 * 3 = 6 e **sem fim");
  });
});

describe("<Blocks>", () => {
  const blocks: ContentBlock[] = contentBlocksSchema.parse([
    { type: "heading", level: 2, text: "Rota" },
    { type: "heading", level: 3, text: "Etapa 1" },
    { type: "paragraph", text: "Comece pelo **Caminho**." },
    { type: "list", ordered: true, items: ["Um", "Dois"] },
    { type: "list", ordered: false, items: ["Solto"] },
    { type: "quote", text: "Vale a pena.", author: "@Cacador_Joaquim" },
    { type: "image", url: "https://cdn.example.com/a.webp", alt: "Mapa de Hallownest", credit: "Team Cherry" },
    { type: "video", youtubeId: "dQw4w9WgXcQ" },
    { type: "callout", tone: "aviso", text: "Salve antes." },
    { type: "callout", tone: "spoiler", text: "O chefe volta." },
    { type: "table", header: ["Etapa", "Horas"], rows: [["1", "4"]] },
    { type: "achievement", apiName: "ACH_PANTHEON" },
    { type: "achievement", apiName: "ACH_X", platform: "psn" },
    { type: "divider" },
  ]);

  it("names a titled video for screen readers and captions it, lazy and privacy-enhanced", () => {
    const { container } = render(
      <Blocks blocks={contentBlocksSchema.parse([{ type: "video", youtubeId: "dQw4w9WgXcQ", title: "Trailer de lançamento" }])} />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(iframe?.getAttribute("title")).toBe("Vídeo do YouTube: Trailer de lançamento");
    expect(iframe?.getAttribute("loading")).toBe("lazy");
    expect(container.querySelector("figcaption")?.textContent).toBe("Trailer de lançamento");
    expect(iframe?.parentElement?.className).toContain("aspect-video");
  });

  it("renders each block as the expected markup", () => {
    const { container } = render(
      <Blocks
        blocks={blocks}
        achievements={{
          [achievementKey("steam", "ACH_PANTHEON")]: {
            name: "Panteão completo",
            description: "Vença todos os panteões.",
            globalPct: 1.2,
            gameName: "Hollow Knight",
          },
        }}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Rota" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Etapa 1" })).toBeInTheDocument();
    expect(screen.getByText("Caminho").tagName).toBe("STRONG");
    expect(container.querySelector("ol")?.children).toHaveLength(2);
    expect(container.querySelector("ul")?.textContent).toBe("Solto");
    expect(container.querySelector("blockquote")?.textContent).toBe("Vale a pena.");
    expect(container.querySelector("figcaption")?.textContent).toBe("@Cacador_Joaquim");

    const img = screen.getByRole("img", { name: "Mapa de Hallownest" });
    expect(img.getAttribute("src")).toBe("https://cdn.example.com/a.webp");
    expect(screen.getByText("Crédito: Team Cherry")).toBeInTheDocument();

    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(iframe?.getAttribute("title")).toBe("Vídeo do YouTube");

    expect(screen.getByRole("complementary", { name: "Atenção" })).toHaveTextContent("Salve antes.");
    const spoiler = container.querySelector("details");
    expect(spoiler?.open).toBe(false);
    expect(spoiler?.textContent).toContain("O chefe volta.");

    expect(screen.getByRole("columnheader", { name: "Etapa" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "4" })).toBeInTheDocument();

    expect(screen.getByText("Panteão completo")).toBeInTheDocument();
    expect(screen.getByText("Lendária")).toBeInTheDocument();
    // Unresolved achievement (psn) falls back to its apiName.
    expect(screen.getByText("Conquista ACH_X")).toBeInTheDocument();

    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.innerHTML).not.toContain("<script");
  });
});
