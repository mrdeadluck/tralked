import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Header } from "./Header";

const pathnameMock = vi.hoisted(() => ({ value: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock.value,
}));

afterEach(() => {
  cleanup();
  pathnameMock.value = "/";
});

const EXPECTED_LINKS = [
  ["Notícias", "/"],
  ["Jogos e guias", "/jogos"],
  ["Personagem", "/jogador/me"],
  ["Highscores", "/highscores"],
  ["Família", "/familia"],
] as const;

function mainNav() {
  return within(screen.getByRole("navigation", { name: "Seções" }));
}

describe("Header", () => {
  it("renders the five main links with their hrefs", () => {
    render(<Header />);
    for (const [label, href] of EXPECTED_LINKS) {
      expect(mainNav().getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    }
    expect(mainNav().getAllByRole("link")).toHaveLength(5);
  });

  it("marks only the link of the current route with aria-current=page", () => {
    pathnameMock.value = "/jogos";
    render(<Header />);
    expect(
      mainNav().getByRole("link", { name: "Jogos e guias" }),
    ).toHaveAttribute("aria-current", "page");
    for (const name of ["Notícias", "Personagem", "Highscores", "Família"]) {
      expect(mainNav().getByRole("link", { name })).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  it("keeps the parent section active on nested routes", () => {
    pathnameMock.value = "/jogos/hollow-knight";
    render(<Header />);
    expect(
      mainNav().getByRole("link", { name: "Jogos e guias" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      mainNav().getByRole("link", { name: "Notícias" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("shows a placeholder level when there is no user", () => {
    render(<Header />);
    expect(screen.getByText("NV —")).toBeInTheDocument();
  });

  it("shows the handle and level of the given user", () => {
    render(<Header user={{ handle: "@lucas", level: 47 }} />);
    expect(screen.getByText("@lucas")).toBeInTheDocument();
    expect(screen.getByText("NV 47")).toBeInTheDocument();
  });
});
