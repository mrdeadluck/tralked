import { describe, expect, it } from "vitest";
import { SKILLS } from "@/lib/engine/types";
import { allBoards, boardFromKey, boardFromPath, boardHref, boardKey, boardTitle, legacySkillBoard } from "./boards";

describe("boardFromPath", () => {
  it("is Nível without a category", () => {
    expect(boardFromPath()).toEqual({ metric: "nivel" });
  });

  it("reads stat boards, every platform by default", () => {
    expect(boardFromPath("horas")).toEqual({ metric: "horas", scope: "all" });
    expect(boardFromPath("horas", "psn")).toEqual({ metric: "horas", scope: "psn" });
    expect(boardFromPath("raras", "switch")).toBeNull();
    expect(boardFromPath("raras", "all")).toBeNull();
  });

  it("reads genre boards", () => {
    expect(boardFromPath("genero", "rpg")).toEqual({ metric: "genero", skill: "rpg" });
    expect(boardFromPath("genero")).toEqual({ metric: "genero", skill: SKILLS[0].id });
    expect(boardFromPath("genero", "x")).toBeNull();
  });

  it("rejects anything else", () => {
    expect(boardFromPath("nivel")).toBeNull();
    expect(boardFromPath("nope")).toBeNull();
  });

  it("maps the old ?skill= links", () => {
    expect(legacySkillBoard("soulslike")).toEqual({ metric: "genero", skill: "soulslike" });
    expect(legacySkillBoard(["rpg"])).toEqual({ metric: "genero", skill: "rpg" });
    expect(legacySkillBoard("geral")).toBeNull();
    expect(legacySkillBoard(undefined)).toBeNull();
  });
});

describe("board keys and links", () => {
  it("round-trips every board through its key and its link", () => {
    const boards = allBoards();
    expect(boards).toHaveLength(1 + 5 * 5 + SKILLS.length);
    expect(new Set(boards.map(boardKey)).size).toBe(boards.length);
    for (const board of boards) {
      expect(boardFromKey(boardKey(board))).toEqual(board);
      const [, , categoria, filtro] = boardHref(board).split("/");
      expect(boardFromPath(categoria, filtro)).toEqual(board);
    }
  });

  it("rejects unknown keys", () => {
    expect(boardFromKey("horas")).toBeNull();
    expect(boardFromKey("horas:wii")).toBeNull();
    expect(boardFromKey("genero:x")).toBeNull();
    expect(boardFromKey("nivel:all")).toBeNull();
  });

  it("names boards in Portuguese", () => {
    expect(boardTitle({ metric: "nivel" })).toBe("Nível");
    expect(boardTitle({ metric: "horas", scope: "all" })).toBe("Horas jogadas");
    expect(boardTitle({ metric: "horas", scope: "psn" })).toBe("Horas jogadas (PlayStation)");
    expect(boardTitle({ metric: "genero", skill: "soulslike" })).toBe("Soulslike");
    expect(boardHref({ metric: "nivel" })).toBe("/highscores");
    expect(boardHref({ metric: "horas", scope: "all" })).toBe("/highscores/horas");
    expect(boardHref({ metric: "horas", scope: "xbox" })).toBe("/highscores/horas/xbox");
    expect(boardHref({ metric: "genero", skill: "rpg" })).toBe("/highscores/genero/rpg");
  });
});
