import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { GuidePayloadInput } from "@/lib/content/guide-schema";
import { GUIDE_COMPAT, WALK_ITEM_KINDS, walkthroughSchema } from "@/lib/content/walkthrough-schema";
import {
  GUIDE_COMPAT as ROBOT_COMPAT,
  WALK_ITEM_KINDS as ROBOT_KINDS,
  type GuidePayloadV2,
  type Walkthrough,
} from "../../src/guias/contract.js";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/walkthrough-pbz.json", import.meta.url)), "utf8"),
) as Walkthrough;

describe("contrato do guia formato 2", () => {
  it("o walkthrough da fixture passa no schema do site", () => {
    const result = walkthroughSchema.safeParse(fixture);
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it("as listas de valores do robô são as do site", () => {
    expect([...ROBOT_KINDS]).toEqual([...WALK_ITEM_KINDS]);
    expect([...ROBOT_COMPAT]).toEqual([...GUIDE_COMPAT]);
  });

  it("GuidePayloadV2 é atribuível ao tipo de entrada do site", () => {
    expectTypeOf<GuidePayloadV2>().toExtend<GuidePayloadInput>();
  });
});
