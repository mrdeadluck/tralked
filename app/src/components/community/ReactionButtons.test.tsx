import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reactTo = vi.fn();
vi.mock("@/lib/community/engagement-actions", () => ({ reactTo }));

const { ReactionButtons } = await import("./ReactionButtons");

const props = {
  targetType: "article" as const,
  targetId: "a1",
  returnTo: "/noticias/x",
  what: "esta notícia",
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("ReactionButtons", () => {
  it("shows no count when there is nothing to count", () => {
    render(<ReactionButtons {...props} likes={0} dislikes={0} mine={0} loggedIn />);
    const like = screen.getByRole("button", { name: "Curtir" });
    expect(like).toHaveAttribute("aria-pressed", "false");
    expect(like.textContent).not.toMatch(/0/);
    expect(screen.getByRole("button", { name: "Não curtir" }).textContent).toBe("");
  });

  it("likes optimistically, then takes the server's counts", async () => {
    let resolve!: (v: unknown) => void;
    reactTo.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<ReactionButtons {...props} likes={2} dislikes={1} mine={-1} loggedIn />);
    fireEvent.click(screen.getByRole("button", { name: /^Curtir/ }));
    // Switch from dislike to like: counts move at once.
    expect(screen.getByRole("button", { name: "Curtir (3 curtidas)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Não curtir" })).toHaveAttribute("aria-pressed", "false");
    expect(reactTo).toHaveBeenCalledWith({ targetType: "article", targetId: "a1", value: 1 });
    await act(async () => resolve({ status: "ok", mine: 1, counts: { likes: 5, dislikes: 0 } }));
    expect(screen.getByRole("button", { name: "Curtir (5 curtidas)" })).toBeInTheDocument();
  });

  it("rolls back and explains a refusal", async () => {
    reactTo.mockResolvedValue({ status: "rate_limited", message: "Você reagiu muitas vezes em pouco tempo." });
    render(<ReactionButtons {...props} likes={1} dislikes={0} mine={0} loggedIn />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Não curtir/ })));
    expect(screen.getByRole("alert")).toHaveTextContent("reagiu muitas vezes");
    expect(screen.getByRole("button", { name: "Não curtir" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Curtir (1 curtida)" })).toBeInTheDocument();
  });

  it("invites visitors to log in (and earn XP) instead of reacting", () => {
    render(<ReactionButtons {...props} likes={0} dislikes={0} mine={0} loggedIn={false} />);
    expect(screen.getByRole("link", { name: "Entre e ganhe XP" })).toHaveAttribute(
      "href",
      expect.stringContaining("returnTo=%2Fnoticias%2Fx"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Curtir" }));
    expect(screen.getByRole("link", { name: "Entre e ganhe XP ao reagir" })).toHaveAttribute(
      "href",
      expect.stringContaining("returnTo=%2Fnoticias%2Fx"),
    );
    expect(reactTo).not.toHaveBeenCalled();
  });

  it("promises the XP until the first reaction, then announces what was earned", async () => {
    const events: unknown[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener("tralked:reward", listener);
    reactTo.mockResolvedValue({
      status: "ok",
      mine: 1,
      counts: { likes: 1, dislikes: 0 },
      reward: { xpGained: 5, reason: "Curtida", skill: null, levelUp: null },
    });
    render(<ReactionButtons {...props} likes={0} dislikes={0} mine={0} loggedIn xpHint={5} />);
    expect(screen.getByText(/\+5 XP/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Curtir" })));
    expect(screen.queryByText(/\+5 XP/)).not.toBeInTheDocument();
    expect(events).toEqual([{ toast: expect.objectContaining({ xp: 5, title: "Curtida", icon: "like" }) }]);
    window.removeEventListener("tralked:reward", listener);
  });
});
