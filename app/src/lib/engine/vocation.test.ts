import { describe, expect, it } from "vitest";
import { SKILLS, type SkillId, type SkillState } from "./types";
import { vocationFor } from "./vocation";

function skillsWith(
  overrides: Partial<Record<SkillId, SkillState>>,
): Record<SkillId, SkillState> {
  const base = {} as Record<SkillId, SkillState>;
  for (const s of SKILLS) base[s.id] = { level: 1, points: 0 };
  return { ...base, ...overrides };
}

describe("vocationFor", () => {
  it("maps the top two skills to a vocation", () => {
    const v = vocationFor(
      skillsWith({
        soulslike: { level: 34, points: 0 },
        plataforma: { level: 31, points: 0 },
      }),
    );
    expect(v).toBe("Lâmina Sombria");
  });

  it("is order independent", () => {
    const v = vocationFor(
      skillsWith({
        plataforma: { level: 40, points: 0 },
        soulslike: { level: 34, points: 0 },
      }),
    );
    expect(v).toBe("Lâmina Sombria");
  });

  it("ignores the sabio skill", () => {
    const v = vocationFor(
      skillsWith({
        sabio: { level: 90, points: 0 },
        fps: { level: 20, points: 0 },
        horror: { level: 15, points: 0 },
      }),
    );
    expect(v).toBe("Caçador");
  });

  it("falls back to Andarilho of the highest skill", () => {
    const v = vocationFor(
      skillsWith({
        fps: { level: 30, points: 0 },
        simulacao: { level: 20, points: 0 },
      }),
    );
    expect(v).toBe("Andarilho de FPS");
  });

  it("breaks level ties by points", () => {
    const v = vocationFor(
      skillsWith({
        fps: { level: 30, points: 10 },
        puzzle: { level: 30, points: 50 },
        simulacao: { level: 30, points: 20 },
      }),
    );
    expect(v).toBe("Andarilho de Puzzle");
  });
});
