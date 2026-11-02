import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentPage, CommentThreadView, CommentView } from "@/lib/community/comments";

vi.mock("@/lib/community/actions", () => ({
  loadMoreComments: vi.fn(),
  postComment: vi.fn(),
  removeComment: vi.fn(),
  updateComment: vi.fn(),
  reportContent: vi.fn(),
}));
vi.mock("@/lib/community/engagement-actions", () => ({ reactTo: vi.fn(), loadReplies: vi.fn() }));
vi.mock("@/lib/moderation/actions", () => ({ moderateCommentAction: vi.fn(), lockDiscussionAction: vi.fn() }));

const { CommentsClient } = await import("./CommentsClient");

const author = (handle: string) => ({ id: handle, handle, displayName: handle, avatarUrl: null });
const view = (over: Partial<CommentView>): CommentView => ({
  id: "c",
  body: "texto",
  createdAt: new Date("2026-11-01T12:00:00Z"),
  editedAt: null,
  author: author("kairo"),
  deleted: false,
  removed: false,
  pinned: false,
  parentId: null,
  replyTo: null,
  likes: 0,
  dislikes: 0,
  ...over,
});

const replies = [
  view({ id: "r1", parentId: "root", body: "primeira", author: author("bia") }),
  view({ id: "r2", parentId: "root", body: "", author: null, removed: true }),
  view({ id: "r3", parentId: "root", body: "concordo", author: author("caio"), replyTo: { handle: "bia" }, likes: 4 }),
];
const root: CommentThreadView = { ...view({ id: "root", body: "raiz", pinned: true }), replies, replyCount: 7 };
const page: CommentPage = { comments: [root], nextCursor: null, total: 7 };

const renderAs = (viewer: { id: string; handle: string; moderator?: boolean } | null, locked = false) =>
  render(<CommentsClient targetType="article" targetId="a1" initial={page} viewer={viewer} returnTo="/noticias/x" locked={locked} />);

afterEach(cleanup);

describe("comment threads", () => {
  it("shows the reply count, the first replies, the @mention and the collapsed rest", () => {
    renderAs(null);
    expect(screen.getByText("7 respostas")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Respostas ao comentário de @kairo" });
    expect(within(list).getByText("primeira")).toBeInTheDocument();
    expect(within(list).getByText("Comentário removido pela moderação")).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: /^Em resposta a\s*@bia$/ })).toHaveAttribute("href", "/jogador/bia");
    expect(screen.getByRole("button", { name: "Ver mais 4 respostas" })).toBeInTheDocument();
    // Counts only when there is something to count.
    expect(within(list).getByRole("button", { name: "Curtir (4 curtidas)" })).toBeInTheDocument();
    expect(screen.getByText("Fixado")).toBeInTheDocument();
  });

  it("opens a reply box answering the chosen comment", () => {
    renderAs({ id: "u1", handle: "eu" });
    const answers = screen.getAllByRole("button", { name: "Responder" });
    fireEvent.click(answers[1]);
    expect(screen.getByRole("textbox", { name: "Responder a @bia" })).toBeInTheDocument();
  });

  it("a locked discussion takes no replies (reactions stay)", () => {
    renderAs({ id: "u1", handle: "eu" }, true);
    expect(screen.queryByRole("button", { name: "Responder" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Curtir/ }).length).toBeGreaterThan(0);
  });

  it("moderators can pin top-level comments only", () => {
    renderAs({ id: "m1", handle: "mod", moderator: true });
    expect(screen.getAllByRole("button", { name: /^(Fixar|Desafixar) / })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Desafixar comentário de @kairo" })).toBeInTheDocument();
  });
});
