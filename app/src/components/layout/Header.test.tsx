import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Header } from "./Header";

const pathnameMock = vi.hoisted(() => ({ value: "/" }));

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock.value,
  useRouter: () => ({ refresh }),
}));

const actions = vi.hoisted(() => ({
  markAllReadAction: vi.fn(async () => ({ ok: true as const })),
  markReadAction: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("@/lib/notifications/actions", () => actions);

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

    it("lists Conta, Conexões and Sair for a regular user, without Admin", () => {
      render(<Header user={USER} />);
      openMenu();
      expect(accountMenu().getByRole("link", { name: "Conta" })).toHaveAttribute("href", "/conta");
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

  describe("notification bell", () => {
    const BELL = {
      unread: 2,
      items: [
        { id: "n1", title: "@ana respondeu seu tópico", body: "Valeu!", href: "/forum/t/1", read: false, when: "há 2 horas" },
        { id: "n2", title: "Você subiu para o nível 48", body: null, href: null, read: false, when: "ontem" },
        { id: "n3", title: "Foto aprovada", body: null, href: "/galeria/x", read: true, when: "há 3 dias" },
      ],
    };

    afterEach(() => {
      actions.markAllReadAction.mockClear();
      actions.markReadAction.mockClear();
    });

    it("is absent without a user", () => {
      render(<Header notifications={BELL} />);
      expect(screen.queryByRole("button", { name: /Notificações/ })).not.toBeInTheDocument();
    });

    it("shows the unread count and lists the notifications, linking to /notificacoes", () => {
      render(<Header user={USER} notifications={BELL} />);
      const trigger = screen.getByRole("button", { name: "Notificações, 2 não lidas" });
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      const panel = within(screen.getByRole("region", { name: "Notificações" }));
      expect(panel.getByRole("link", { name: /@ana respondeu seu tópico/ })).toHaveAttribute("href", "/forum/t/1");
      expect(panel.getByText("Você subiu para o nível 48")).toBeInTheDocument();
      expect(panel.getByRole("link", { name: "Ver todas" })).toHaveAttribute("href", "/notificacoes");
    });

    it("marks all as read and clears the count", async () => {
      render(<Header user={USER} notifications={BELL} />);
      fireEvent.click(screen.getByRole("button", { name: /Notificações/ }));
      fireEvent.click(screen.getByRole("button", { name: "Marcar todas como lidas" }));
      expect(await screen.findByRole("button", { name: "Notificações" })).toBeInTheDocument();
      expect(actions.markAllReadAction).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Marcar todas como lidas" })).not.toBeInTheDocument();
    });

    it("follows new server data (e.g. after marking all read on /notificacoes)", () => {
      const { rerender } = render(<Header user={USER} notifications={BELL} />);
      expect(screen.getByRole("button", { name: "Notificações, 2 não lidas" })).toBeInTheDocument();
      rerender(
        <Header user={USER} notifications={{ unread: 0, items: BELL.items.map((n) => ({ ...n, read: true })) }} />,
      );
      expect(screen.getByRole("button", { name: "Notificações" })).toBeInTheDocument();
      rerender(
        <Header
          user={USER}
          notifications={{ unread: 1, items: [{ id: "n9", title: "Nova resposta", body: null, href: null, read: false, when: "agora" }] }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Notificações, 1 não lida" }));
      expect(screen.getByText("Nova resposta")).toBeInTheDocument();
    });

    it("marks one as read when it is opened", () => {
      render(<Header user={USER} notifications={BELL} />);
      fireEvent.click(screen.getByRole("button", { name: /Notificações/ }));
      // jsdom cannot navigate; the link's own click handler still runs.
      const stop = (event: Event) => event.preventDefault();
      document.addEventListener("click", stop, { capture: true });
      fireEvent.click(screen.getByRole("link", { name: /@ana respondeu/ }));
      document.removeEventListener("click", stop, { capture: true });
      expect(actions.markReadAction).toHaveBeenCalledWith("n1");
      expect(screen.getByRole("button", { name: "Notificações, 1 não lida" })).toBeInTheDocument();
    });

    it("has an empty state", () => {
      render(<Header user={USER} notifications={{ unread: 0, items: [] }} />);
      fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
      expect(screen.getByText(/Nada por aqui ainda/)).toBeInTheDocument();
    });
  });
});
