import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SearchBox } from "./SearchBox";

const SUGGESTIONS = [
  { text: "Hollow Knight", href: "/jogos/hollow-knight" },
  { text: "Hades", href: "/jogos/hades" },
  { text: "Celeste", href: "/jogos/celeste" },
];

afterEach(cleanup);

function setup() {
  render(<SearchBox suggestions={SUGGESTIONS} />);
  const input = screen.getByRole("combobox");
  act(() => input.focus());
  return input;
}

function options() {
  return screen.getAllByRole("option");
}

describe("SearchBox", () => {
  it("does not render the panel without suggestions", () => {
    render(<SearchBox />);
    const input = screen.getByRole("combobox");
    act(() => input.focus());
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByText("EM ALTA")).not.toBeInTheDocument();
  });

  it("opens a listbox with the suggestions on focus", () => {
    const input = setup();
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute(
      "aria-controls",
      screen.getByRole("listbox").id,
    );
    expect(screen.getByText("EM ALTA")).toBeInTheDocument();
    expect(options().map((o) => o.textContent)).toEqual([
      "Hollow Knight",
      "Hades",
      "Celeste",
    ]);
    expect(options()[1]).toHaveAttribute("href", "/jogos/hades");
  });

  it("moves focus through the options with ArrowDown/ArrowUp", () => {
    const input = setup();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options()[0]).toHaveFocus();
    fireEvent.keyDown(options()[0], { key: "ArrowDown" });
    expect(options()[1]).toHaveFocus();
    fireEvent.keyDown(options()[1], { key: "ArrowDown" });
    fireEvent.keyDown(options()[2], { key: "ArrowDown" });
    expect(options()[2]).toHaveFocus();
    fireEvent.keyDown(options()[2], { key: "ArrowUp" });
    expect(options()[1]).toHaveFocus();
    fireEvent.keyDown(options()[1], { key: "ArrowUp" });
    fireEvent.keyDown(options()[0], { key: "ArrowUp" });
    expect(input).toHaveFocus();
  });

  it("keeps the panel open while focus is on an option", () => {
    const input = setup();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options()[0]).toHaveFocus();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("closes the panel when focus leaves the search box", () => {
    const input = setup();
    act(() => input.blur());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape and returns focus to the input without reopening", () => {
    const input = setup();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(options()[0], { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape from the input and reopens with ArrowDown", () => {
    const input = setup();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("focuses the input when / is pressed outside a field", () => {
    render(<SearchBox suggestions={SUGGESTIONS} />);
    fireEvent.keyDown(document.body, { key: "/" });
    expect(screen.getByRole("combobox")).toHaveFocus();
  });
});
