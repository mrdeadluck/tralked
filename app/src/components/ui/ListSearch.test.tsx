import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const { ListSearch, SEARCH_DEBOUNCE_MS } = await import("./ListSearch");

describe("ListSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    replace.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("is a GET form that keeps the filters (not the page) for submissions without JavaScript", () => {
    const { container } = render(
      <ListSearch basePath="/jogos" params={{ plataforma: "PC", por: "80", pagina: "4", q: "old" }} q="old" label="Buscar jogo" />,
    );
    const form = container.querySelector("form")!;
    expect(form).toHaveAttribute("action", "/jogos");
    expect(form).toHaveAttribute("method", "get");
    const hidden = [...form.querySelectorAll('input[type="hidden"]')].map((i) => [i.getAttribute("name"), i.getAttribute("value")]);
    expect(hidden).toEqual([
      ["plataforma", "PC"],
      ["por", "80"],
    ]);
    expect(screen.getByRole("searchbox", { name: "Buscar jogo" })).toHaveAttribute("name", "q");
  });

  it("searches while typing after a pause, back to page 1, keeping the filters", () => {
    render(<ListSearch basePath="/jogos" params={{ plataforma: "PC", pagina: "3" }} label="Buscar jogo" />);
    const input = screen.getByRole("searchbox", { name: "Buscar jogo" });
    fireEvent.change(input, { target: { value: "hol" } });
    fireEvent.change(input, { target: { value: "hollow" } });
    expect(replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/jogos?plataforma=PC&q=hollow", { scroll: false });
  });

  it("clearing the field removes the query", () => {
    render(<ListSearch basePath="/familia" params={{}} q="hades" label="Buscar" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(replace).toHaveBeenCalledWith("/familia", { scroll: false });
  });

  it("submitting searches at once", () => {
    render(<ListSearch basePath="/jogos" params={{}} label="Buscar" />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "celeste" } });
    fireEvent.submit(input.closest("form")!);
    expect(replace).toHaveBeenCalledWith("/jogos?q=celeste", { scroll: false });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
