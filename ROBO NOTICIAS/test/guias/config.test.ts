import { describe, expect, it } from "vitest";
import { loadGuideConfig } from "../../src/guias/config.js";

const ENV = { ANTHROPIC_API_KEY: "a", TRALKED_GUIDES_API_KEY: "k" };

describe("loadGuideConfig", () => {
  it("applies the defaults", () => {
    const c = loadGuideConfig(ENV);
    expect(c).toMatchObject({
      TRALKED_API_URL: "https://tralked.com",
      MODEL_WRITER: "claude-opus-5-5",
      MODEL_EXTRACT: "claude-sonnet-5-5",
      MODEL_FAST: "claude-haiku-5-5",
      GUIDE_BUDGET_USD: 25,
      DATA_DIR_GUIAS: "./data-guias",
      GUIDE_STEAM_REFERENCE_ID: "76561198012210783",
    });
    expect(c.RESEND_API_KEY).toBeUndefined();
  });

  it("requires both keys and treats blanks as unset", () => {
    expect(() => loadGuideConfig({ TRALKED_GUIDES_API_KEY: "k" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadGuideConfig({ ANTHROPIC_API_KEY: "a", TRALKED_GUIDES_API_KEY: "" })).toThrow(/TRALKED_GUIDES_API_KEY/);
  });

  it("reads overrides", () => {
    const c = loadGuideConfig({ ...ENV, GUIDE_BUDGET_USD: "40", MODEL_FAST: "x", ALERT_EMAIL: "a@b.c", GUIDE_STEAM_REFERENCE_ID: "76561197960287930" });
    expect(c.GUIDE_STEAM_REFERENCE_ID).toBe("76561197960287930");
    expect(() => loadGuideConfig({ ...ENV, GUIDE_STEAM_REFERENCE_ID: "nope" })).toThrow(/GUIDE_STEAM_REFERENCE_ID/);
    expect(c.GUIDE_BUDGET_USD).toBe(40);
    expect(c.MODEL_FAST).toBe("x");
    expect(c.ALERT_EMAIL).toBe("a@b.c");
  });
});
