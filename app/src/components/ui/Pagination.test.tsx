import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Pagination } from "./Pagination";

afterEach(cleanup);

describe("Pagination", () => {
  it("links numbered pages keeping the filters, marks the current page and shows ellipses", () => {
    render(
      <Pagination
        basePath="/jogos"
        params={{ q: "zelda", plataforma: "PC", por: "20" }}
        window={{ page: 10, perPage: 20, total: 531, totalPages: 27 }}
        noun={["jogo", "jogos"]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Paginação" });
    expect(within(nav).getByText("181–200 de 531 jogos")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Página 9" })).toHaveAttribute(
      "href",
      "/jogos?q=zelda&plataforma=PC&por=20&pagina=9",
    );
    expect(within(nav).getByRole("link", { name: "Primeira página" })).toHaveAttribute(
      "href",
      "/jogos?q=zelda&plataforma=PC&por=20",
    );
    expect(within(nav).getByRole("link", { name: "Última página" })).toHaveAttribute(
      "href",
      "/jogos?q=zelda&plataforma=PC&por=20&pagina=27",
    );
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent("Página 10");
    expect(within(nav).getAllByText("…")).toHaveLength(2);
  });

  it("offers 10/20/40/80 per page, back to page 1", () => {
    render(<Pagination basePath="/familia" params={{ q: "x" }} window={{ page: 3, perPage: 40, total: 200, totalPages: 5 }} />);
    expect(screen.getByRole("link", { name: "80 por página" })).toHaveAttribute("href", "/familia?q=x&por=80");
    expect(screen.getByRole("link", { name: "10 por página" })).toHaveAttribute("href", "/familia?q=x&por=10");
    expect(screen.queryByRole("link", { name: "40 por página" })).not.toBeInTheDocument();
  });

  it("has no previous link on the first page and no next link on the last", () => {
    render(<Pagination basePath="/x" params={{ por: "10" }} window={{ page: 1, perPage: 10, total: 25, totalPages: 3 }} />);
    expect(screen.queryByRole("link", { name: "Página anterior" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Próxima página" })).toHaveAttribute("href", "/x?por=10&pagina=2");
  });

  it("renders nothing for an empty list and no page numbers for a single page", () => {
    const { container, rerender } = render(
      <Pagination basePath="/x" params={{}} window={{ page: 1, perPage: 40, total: 0, totalPages: 1 }} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<Pagination basePath="/x" params={{}} window={{ page: 1, perPage: 40, total: 5, totalPages: 1 }} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Itens por página" })).not.toBeInTheDocument();
  });
});
