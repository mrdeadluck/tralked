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
  ["Notícias", "/noticias"],
  ["Ranking", "/highscores"],
  // Logged out, "Personagem" is the character showcase, not a login wall.
  ["Personagem", "/personagem"],
] as const;

const USER = { handle: "@lucas", level: 47, role: "user" };

function accountMenu() {
  return within(screen.getByRole("group", { name: "Conta" }));
}

function mainNav() {
  return within(screen.getByRole("navigation", { name: "Seções" }));
}

const jogos = () => mainNav().getByRole("button", { name: /^Jogos/ });
const comunidade = () => mainNav().getByRole("button", { name: /^Comunidade/ });
const panelOf = (button: HTMLElement) => document.getElementById(button.getAttribute("aria-controls")!)!;

describe("Header", () => {
  it("renders Notícias, the Jogos and Comunidade menus, Ranking and Personagem", () => {
    render(<Header />);
    for (const [label, href] of EXPECTED_LINKS) {
      expect(mainNav().getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
    // The menus are closed: only the three plain links are visible.
    expect(mainNav().getAllByRole("link")).toHaveLength(3);
    expect(jogos()).toHaveAttribute("aria-expanded", "false");
    expect(comunidade()).toHaveAttribute("aria-expanded", "false");
  });

  it("marks Notícias as the current page on /noticias and its articles", () => {
    pathnameMock.value = "/noticias/uma-materia";
    render(<Header />);
    expect(mainNav().getByRole("link", { name: "Notícias" })).toHaveAttribute("aria-current", "page");
    for (const name of ["Ranking", "Personagem"]) {
      expect(mainNav().getByRole("link", { name })).not.toHaveAttribute("aria-current");
    }
  });

  it("marks the Jogos menu as the current section on catalog, game, releases and calendar pages", () => {
    for (const path of ["/jogos", "/jogos/hollow-knight", "/lancamentos", "/calendario/2026-11"]) {
      pathnameMock.value = path;
      const { unmount } = render(<Header />);
      expect(jogos()).toHaveAccessibleName(/^Jogos ?\(seção atual\)$/);
      expect(jogos()).toHaveAttribute("data-current", "true");
      expect(comunidade()).not.toHaveAttribute("data-current");
      expect(mainNav().getByRole("link", { name: "Notícias" })).not.toHaveAttribute("aria-current");
      unmount();
    }
  });

  it("marks the Comunidade menu on forum, gallery and family pages", () => {
    pathnameMock.value = "/forum/ajuda";
    render(<Header />);
    expect(comunidade()).toHaveAttribute("data-current", "true");
    expect(jogos()).not.toHaveAttribute("data-current");
  });

  it("offers an Entrar button to the Tralked login when there is no user (never Steam)", () => {
    render(<Header />);
    expect(screen.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", "/entrar?returnTo=%2Fjogador%2Fme");
    // ("Steam / PC" in the Jogos menu is a catalog filter, not a way in.)
    expect(screen.queryByRole("link", { name: /Steam/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Steam/ })).not.toBeInTheDocument();
  });

  it("points Personagem at the user's own sheet when logged in", () => {
    pathnameMock.value = "/jogador/%40lucas";
    render(<Header user={USER} />);
    const link = mainNav().getByRole("link", { name: "Personagem" });
    expect(link).toHaveAttribute("href", "/jogador/%40lucas");
    expect(link).toHaveAttribute("aria-current", "page");
  });

  describe("phone search", () => {
    it("is a button that opens the search field, focused, and Esc folds it away", () => {
      render(<Header />);
      const button = screen.getByRole("button", { name: "Buscar jogos" });
      const sheet = document.getElementById(button.getAttribute("aria-controls")!)!;
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(sheet.className).toMatch(/max-nav:hidden/);
      fireEvent.click(button);
      expect(screen.getByRole("button", { name: "Fechar busca" })).toHaveAttribute("aria-expanded", "true");
      expect(sheet.className).not.toMatch(/max-nav:hidden/);
      const input = screen.getByRole("combobox", { name: "Buscar jogos" });
      expect(input).toHaveFocus();
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.getByRole("button", { name: "Buscar jogos" })).toHaveAttribute("aria-expanded", "false");
    });

    it("is not offered on /jogos, which has its own catalog search", () => {
      pathnameMock.value = "/jogos";
      render(<Header />);
      expect(screen.queryByRole("button", { name: "Buscar jogos" })).not.toBeInTheDocument();
    });
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
    const SECTIONS = [
      ["Catálogo", "/jogos"],
      ["Lançamentos", "/lancamentos"],
      ["Calendário", "/calendario"],
      ["Guias 100%", "/jogos?guia=1"],
    ] as const;
    const PLATFORMS = [
      ["Steam / PC", "/jogos?plataforma=PC"],
      ["PlayStation", "/jogos?plataforma=PLAYSTATION"],
      ["Xbox", "/jogos?plataforma=XBOX"],
      ["Nintendo", "/jogos?plataforma=NINTENDO"],
      ["Retro", "/jogos?plataforma=RETRO"],
    ] as const;

    it("is a disclosure: closed by default, a click toggles it, sections then platforms", () => {
      render(<Header />);
      expect(mainNav().queryByRole("link", { name: /Catálogo/ })).not.toBeInTheDocument();
      fireEvent.click(jogos());
      expect(jogos()).toHaveAttribute("aria-expanded", "true");
      const panel = panelOf(jogos());
      expect(panel).toBeVisible();
      const links = within(panel).getAllByRole("link");
      expect(links.map((a) => [a.querySelector("b")?.textContent, a.getAttribute("href")])).toEqual([
        ...SECTIONS,
        ...PLATFORMS,
      ]);
      fireEvent.click(jogos());
      expect(jogos()).toHaveAttribute("aria-expanded", "false");
    });

    it("marks the current page inside the panel", () => {
      pathnameMock.value = "/lancamentos";
      render(<Header />);
      fireEvent.click(jogos());
      expect(within(panelOf(jogos())).getByRole("link", { name: /Lançamentos/ })).toHaveAttribute("aria-current", "page");
      expect(within(panelOf(jogos())).getByRole("link", { name: /Catálogo/ })).not.toHaveAttribute("aria-current");
    });

    it("opens on mouse hover and closes shortly after the pointer leaves", () => {
      vi.useFakeTimers();
      try {
        render(<Header />);
        const group = jogos().parentElement!;
        fireEvent.pointerEnter(group, { pointerType: "mouse" });
        expect(jogos()).toHaveAttribute("aria-expanded", "true");
        fireEvent.pointerLeave(group, { pointerType: "mouse" });
        act(() => {
          vi.advanceTimersByTime(300);
        });
        expect(jogos()).toHaveAttribute("aria-expanded", "false");
      } finally {
        vi.useRealTimers();
      }
    });

    it("a click right after the hover opened it keeps it open (pins it)", () => {
      render(<Header />);
      fireEvent.pointerEnter(jogos().parentElement!, { pointerType: "mouse" });
      fireEvent.click(jogos());
      expect(jogos()).toHaveAttribute("aria-expanded", "true");
      fireEvent.click(jogos());
      expect(jogos()).toHaveAttribute("aria-expanded", "false");
    });

    it("keyboard: ArrowDown opens it on the first link, arrows walk the links, Esc returns to the button", () => {
      render(
        <>
          <Header />
          <button type="button">depois</button>
        </>,
      );
      act(() => jogos().focus());
      // Focus alone does not open it.
      expect(jogos()).toHaveAttribute("aria-expanded", "false");
      fireEvent.keyDown(jogos(), { key: "ArrowDown" });
      expect(jogos()).toHaveAttribute("aria-expanded", "true");
      const panel = within(panelOf(jogos()));
      expect(panel.getByRole("link", { name: /Catálogo/ })).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
      expect(panel.getByRole("link", { name: /Lançamentos/ })).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
      fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
      expect(panel.getByRole("link", { name: /Retro/ })).toHaveFocus();
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect(jogos()).toHaveAttribute("aria-expanded", "false");
      expect(jogos()).toHaveFocus();

      fireEvent.click(jogos());
      fireEvent.blur(jogos(), { relatedTarget: screen.getByRole("button", { name: "depois" }) });
      expect(jogos()).toHaveAttribute("aria-expanded", "false");
    });

    it("touch: a tap outside closes it (no blur on iOS)", () => {
      render(
        <>
          <Header />
          <p>fora</p>
        </>,
      );
      fireEvent.click(jogos());
      expect(jogos()).toHaveAttribute("aria-expanded", "true");
      fireEvent.pointerDown(screen.getByText("fora"));
      expect(jogos()).toHaveAttribute("aria-expanded", "false");
    });

    it("Esc closes it from anywhere (focus stays where it was), and navigating closes it", () => {
      const { rerender } = render(<Header />);
      fireEvent.click(jogos());
      act(() => (document.activeElement as HTMLElement | null)?.blur());
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(jogos()).toHaveAttribute("aria-expanded", "false");
      expect(jogos()).not.toHaveFocus();

      fireEvent.click(jogos());
      expect(jogos()).toHaveAttribute("aria-expanded", "true");
      pathnameMock.value = "/jogos";
      rerender(<Header />);
      expect(jogos()).toHaveAttribute("aria-expanded", "false");
    });

    it("Comunidade lists Fórum, Galeria and Família", () => {
      render(<Header />);
      fireEvent.click(comunidade());
      const links = within(panelOf(comunidade())).getAllByRole("link");
      expect(links.map((a) => [a.querySelector("b")?.textContent, a.getAttribute("href")])).toEqual([
        ["Fórum", "/forum"],
        ["Galeria", "/galeria"],
        ["Família", "/familia"],
      ]);
    });

    it("the mobile drawer has the same sections, the menus as groups, and Esc closes it", () => {
      render(<Header />);
      fireEvent.click(screen.getByRole("button", { name: "Abrir menu" }));
      const drawer = within(screen.getByRole("navigation", { name: "Menu" }));
      const list = within(drawer.getByRole("list", { name: "Jogos por plataforma" }));
      expect(list.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual(PLATFORMS);
      for (const [label, href] of [...SECTIONS, ["Fórum", "/forum"], ["Família", "/familia"], ["Ranking", "/highscores"], ["Personagem", "/personagem"]]) {
        expect(drawer.getByRole("link", { name: label })).toHaveAttribute("href", href);
      }
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(screen.getByRole("button", { name: "Abrir menu" })).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByRole("button", { name: "Abrir menu" })).toHaveFocus();
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
