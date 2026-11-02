import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentPage, CommentView } from "@/lib/community/comments";

vi.mock("@/lib/community/actions", () => ({
  loadMoreComments: vi.fn(),
  postComment: vi.fn(),
  removeComment: vi.fn(),
  updateComment: vi.fn(),
  reportContent: vi.fn(),
}));
vi.mock("@/lib/moderation/actions", () => ({ moderateCommentAction: vi.fn(), lockDiscussionAction: vi.fn() }));

const { CommentsClient } = await import("@/components/community/CommentsClient");

const author = { id: "a1", handle: "kairo", displayName: "Kairo", avatarUrl: null };
const comment = (over: Partial<CommentView>): CommentView => ({
  id: "c",
  body: "texto",
  createdAt: new Date("2026-11-01T12:00:00Z"),
  editedAt: null,
  author,
  deleted: false,
  removed: false,
  pinned: false,
  ...over,
});

const page: CommentPage = {
  comments: [
    comment({ id: "c1", body: "fixado aqui", pinned: true }),
    comment({ id: "c2", body: "", author: null, removed: true }),
    comment({ id: "c3", body: "", author: null, deleted: true }),
  ],
  nextCursor: null,
  total: 1,
};

const renderAs = (viewer: { id: string; handle: string; moderator?: boolean } | null, locked = false) =>
  render(<CommentsClient targetType="article" targetId="a1" initial={page} viewer={viewer} returnTo="/noticias/x" locked={locked} />);

afterEach(cleanup);

describe("comments: moderation states", () => {
  it("shows the pinned mark and the two different placeholders", () => {
    renderAs(null);
    expect(screen.getByText("Fixado")).toBeInTheDocument();
    expect(screen.getByText("Comentário removido pela moderação")).toBeInTheDocument();
    expect(screen.getByText("Comentário apagado")).toBeInTheDocument();
  });

  it("hides moderation controls from regular users", () => {
    renderAs({ id: "u1", handle: "eu" });
    expect(screen.queryByRole("button", { name: /Remover comentário/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Trancar discussão/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Denunciar comentário de @kairo" })).toBeInTheDocument();
  });

  it("gives moderators pin, remove and lock controls", () => {
    renderAs({ id: "m1", handle: "mod", moderator: true });
    expect(screen.getByRole("button", { name: "Desafixar comentário de @kairo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover comentário de @kairo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trancar discussão" })).toBeInTheDocument();
  });

  it("a locked discussion shows a notice instead of the comment box", () => {
    renderAs({ id: "u1", handle: "eu" }, true);
    expect(screen.getByText(/Discussão trancada/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Escreva um comentário" })).toBeNull();
  });
});
