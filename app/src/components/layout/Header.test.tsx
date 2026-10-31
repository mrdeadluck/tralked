import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  // Logged out, "Personagem" goes to the Tralked login, which comes back to the sheet.
  ["Personagem", "/entrar?returnTo=%2Fjogador%2Fme"],
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

  it("offers an Entrar button to the Tralked login when there is no user (never Steam)", () => {
    render(<Header />);
    expect(screen.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", "/entrar?returnTo=%2Fjogador%2Fme");
    // ("Steam / PC" in the Jogos menu is a catalog filter, not a way in.)
    expect(screen.queryByRole("link", { name: /Steam/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Steam/ })).not.toBeInTheDocument();
  });

  it("points Personagem at the user's own sheet when logged in", () => {
    render(<Header user={USER} />);
    expect(mainNav().getByRole("link", { name: "Personagem" })).toHaveAttribute("href", "/jogador/%40lucas");
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

  describe("Jogos menu", () => {
    const PLATFORMS = [
      ["Steam / PC", "/jogos?plataforma=PC"],
      ["PlayStation", "/jogos?plataforma=PLAYSTATION"],
      ["Xbox", "/jogos?plataforma=XBOX"],
      ["Nintendo", "/jogos?plataforma=NINTENDO"],
      ["Retro", "/jogos?plataforma=RETRO"],
    ] as const;
    const toggle = () => mainNav().getByRole("button", { name: "Jogos por plataforma" });

    it("is a disclosure: closed by default, the button toggles it, Steam / PC first", () => {
      render(<Header />);
      expect(toggle()).toHaveAttribute("aria-expanded", "false");
      expect(mainNav().queryByRole("link", { name: /Steam \/ PC/ })).not.toBeInTheDocument();
      fireEvent.click(toggle());
      expect(toggle()).toHaveAttribute("aria-expanded", "true");
      const panel = document.getElementById(toggle().getAttribute("aria-controls")!)!;
      expect(panel).toBeVisible();
      const links = within(panel).getAllByRole("link");
      expect(links.slice(0, 5).map((a) => [a.querySelector("b")?.textContent, a.getAttribute("href")])).toEqual(PLATFORMS);
      expect(within(panel).getByRole("link", { name: /Todos os jogos/ })).toHaveAttribute("href", "/jogos");
      fireEvent.click(toggle());
      expect(toggle()).toHaveAttribute("aria-expanded", "false");
    });

    it("opens on mouse hover and closes shortly after the pointer leaves", () => {
      vi.useFakeTimers();
      try {
        render(<Header />);
        const group = toggle().parentElement!;
        fireEvent.pointerEnter(group, { pointerType: "mouse" });
        expect(toggle()).toHaveAttribute("aria-expanded", "true");
        fireEvent.pointerLeave(group, { pointerType: "mouse" });
        act(() => {
          vi.advanceTimersByTime(300);
        });
        expect(toggle()).toHaveAttribute("aria-expanded", "false");
      } finally {
        vi.useRealTimers();
      }
    });

    it("opens when the Jogos link gets keyboard focus, Esc closes it back to the button, leaving closes it", () => {
      render(
        <>
          <Header />
          <button type="button">depois</button>
        </>,
      );
      act(() => mainNav().getByRole("link", { name: "Jogos" }).focus());
      expect(toggle()).toHaveAttribute("aria-expanded", "true");
      fireEvent.keyDown(toggle(), { key: "Escape" });
      expect(toggle()).toHaveAttribute("aria-expanded", "false");
      expect(toggle()).toHaveFocus();

      fireEvent.click(toggle());
      fireEvent.blur(toggle(), { relatedTarget: screen.getByRole("button", { name: "depois" }) });
      expect(toggle()).toHaveAttribute("aria-expanded", "false");
    });

    it("touch: a tap outside closes it (no blur on iOS), and a tap that focuses the link does not open it", () => {
      render(
        <>
          <Header />
          <p>fora</p>
        </>,
      );
      fireEvent.click(toggle());
      expect(toggle()).toHaveAttribute("aria-expanded", "true");
      fireEvent.pointerDown(screen.getByText("fora"));
      expect(toggle()).toHaveAttribute("aria-expanded", "false");

      // Android: pointerdown, then the emulated focus, then the click.
      const link = mainNav().getByRole("link", { name: "Jogos" });
      fireEvent.pointerDown(link, { pointerType: "touch" });
      act(() => link.focus());
      expect(toggle()).toHaveAttribute("aria-expanded", "false");
      link.addEventListener("click", (e) => e.preventDefault(), { once: true });
      fireEvent.click(link);
      // The press is over: keyboard focus opens it again.
      act(() => link.blur());
      act(() => link.focus());
      expect(toggle()).toHaveAttribute("aria-expanded", "true");
    });

    it("Esc closes it from anywhere (focus stays where it was), and navigating closes it", () => {
      const { rerender } = render(<Header />);
      fireEvent.click(toggle());
      act(() => (document.activeElement as HTMLElement | null)?.blur());
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(toggle()).toHaveAttribute("aria-expanded", "false");
      expect(toggle()).not.toHaveFocus();

      fireEvent.click(toggle());
      expect(toggle()).toHaveAttribute("aria-expanded", "true");
      pathnameMock.value = "/jogos";
      rerender(<Header />);
      expect(toggle()).toHaveAttribute("aria-expanded", "false");
    });

    it("the mobile drawer lists the same platforms under Jogos", () => {
      render(<Header />);
      fireEvent.click(screen.getByRole("button", { name: "Abrir menu" }));
      const drawer = within(screen.getByRole("navigation", { name: "Menu" }));
      const list = within(drawer.getByRole("list", { name: "Jogos por plataforma" }));
      expect(list.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual(PLATFORMS);
    });
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
