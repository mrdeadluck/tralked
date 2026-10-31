import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  ["Jogos", "/jogos"],
  ["Fórum", "/forum"],
  ["Galeria", "/galeria"],
  ["Personagem", "/jogador/me"],
  ["Highscores", "/highscores"],
  ["Família", "/familia"],
] as const;

const USER = { handle: "@lucas", level: 47, role: "user" };

function accountMenu() {
  return within(screen.getByRole("group", { name: "Conta" }));
}

function mainNav() {
  return within(screen.getByRole("navigation", { name: "Seções" }));
}

describe("Header", () => {
  it("renders the seven main links with their hrefs", () => {
    render(<Header />);
    for (const [label, href] of EXPECTED_LINKS) {
      expect(mainNav().getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    }
    expect(mainNav().getAllByRole("link")).toHaveLength(7);
  });

  it("marks only the link of the current route with aria-current=page", () => {
    pathnameMock.value = "/jogos";
    render(<Header />);
    expect(
      mainNav().getByRole("link", { name: "Jogos" }),
    ).toHaveAttribute("aria-current", "page");
    for (const name of ["Notícias", "Fórum", "Galeria", "Personagem", "Highscores", "Família"]) {
      expect(mainNav().getByRole("link", { name })).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  it("keeps the parent section active on nested routes", () => {
    pathnameMock.value = "/jogos/hollow-knight";
    render(<Header />);
    expect(
      mainNav().getByRole("link", { name: "Jogos" }),
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
    render(<Header user={USER} />);
    expect(screen.getByText("@lucas")).toBeInTheDocument();
    expect(screen.getByText("NV 47")).toBeInTheDocument();
  });

  it("offers a logout form posting to /api/auth/logout, in the header and in the mobile drawer", () => {
    const { container } = render(<Header user={USER} />);
    const forms = container.querySelectorAll('form[action="/api/auth/logout"]');
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(form).toHaveAttribute("method", "post");
      expect(within(form as HTMLElement).getByRole("button", { name: "Sair", hidden: true })).toHaveAttribute(
        "type",
        "submit",
      );
    }
  });

  it("has no logout form when there is no user", () => {
    const { container } = render(<Header />);
    expect(container.querySelectorAll('form[action="/api/auth/logout"]')).toHaveLength(0);
  });

  describe("account menu", () => {
    function openMenu() {
      fireEvent.click(accountMenu().getByRole("button", { name: /@lucas/ }));
    }

    it("is collapsed by default and toggles with aria-expanded", () => {
      render(<Header user={USER} />);
      const trigger = accountMenu().getByRole("button", { name: /@lucas/ });
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      fireEvent.keyDown(trigger, { key: "Escape" });
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });

    it("lists Conexões and Sair for a regular user, without Admin", () => {
      render(<Header user={USER} />);
      openMenu();
      expect(accountMenu().getByRole("link", { name: "Conexões" })).toHaveAttribute(
        "href",
        "/conta/conexoes",
      );
      expect(accountMenu().getByRole("button", { name: "Sair" })).toBeVisible();
      expect(accountMenu().queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    });

    it.each(["admin", "editor"])("shows Admin for the %s role", (role) => {
      render(<Header user={{ ...USER, role }} />);
      openMenu();
      expect(accountMenu().getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
    });

    it("has no account menu without a user", () => {
      render(<Header />);
      expect(screen.queryByRole("group", { name: "Conta" })).not.toBeInTheDocument();
    });
  });
});
