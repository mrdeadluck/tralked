import { describe, expect, it } from "vitest";
import { loadDryRunConfig, loadGuideConfig } from "../../src/guias/config.js";

const ENV = { ANTHROPIC_API_KEY: "a", TRALKED_GUIDES_API_KEY: "k" };

describe("loadGuideConfig", () => {
  it("applies the defaults", () => {
    const c = loadGuideConfig(ENV);
    expect(c).toMatchObject({
      TRALKED_API_URL: "https://tralked.com",
      MODEL_WRITER: "claude-opus-5-5",
      MODEL_EXTRACT: "claude-sonnet-5-5",
      MODEL_FAST: "claude-haiku-5-5",
      MODEL_CHECK: "claude-sonnet-5-5",
      CHECK_EFFORT: "high",
      EXTRACT_EFFORT: "medium",
      GUIDE_BUDGET_USD: 25,
      DATA_DIR_GUIAS: "./data-guias",
      GUIDE_STEAM_REFERENCE_ID: "76561198012210783",
      GUIDE_SOFT_DEADLINE_MIN: 150,
      GUIDE_FORCE_DISCOVERY: false,
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
    expect(loadGuideConfig({ ...ENV, GUIDE_SOFT_DEADLINE_MIN: "90" }).GUIDE_SOFT_DEADLINE_MIN).toBe(90);
    expect(loadGuideConfig({ ...ENV, GUIDE_FORCE_DISCOVERY: "1" }).GUIDE_FORCE_DISCOVERY).toBe(true);
    expect(loadGuideConfig({ ...ENV, GUIDE_FORCE_DISCOVERY: "true" }).GUIDE_FORCE_DISCOVERY).toBe(true);
    expect(loadGuideConfig({ ...ENV, GUIDE_FORCE_DISCOVERY: "0" }).GUIDE_FORCE_DISCOVERY).toBe(false);
    // Task 22: the checker's model and effort; effort above high is valid (the API takes xhigh and max).
    expect(loadGuideConfig({ ...ENV, MODEL_CHECK: "claude-opus-5-5", CHECK_EFFORT: "xhigh" })).toMatchObject({ MODEL_CHECK: "claude-opus-5-5", CHECK_EFFORT: "xhigh" });
    expect(loadGuideConfig({ ...ENV, CHECK_EFFORT: "max" }).CHECK_EFFORT).toBe("max");
    expect(loadGuideConfig({ ...ENV, CHECK_EFFORT: "" }).CHECK_EFFORT).toBe("high");
    expect(() => loadGuideConfig({ ...ENV, CHECK_EFFORT: "turbo" })).toThrow(/CHECK_EFFORT/);
    // Task 25: Opus may read (extraction) and check; the extraction's effort is its own setting.
    expect(loadGuideConfig({ ...ENV, MODEL_EXTRACT: "claude-opus-5-5", EXTRACT_EFFORT: "high" })).toMatchObject({ MODEL_EXTRACT: "claude-opus-5-5", EXTRACT_EFFORT: "high" });
    expect(loadGuideConfig({ ...ENV, EXTRACT_EFFORT: "" }).EXTRACT_EFFORT).toBe("medium");
    expect(() => loadGuideConfig({ ...ENV, EXTRACT_EFFORT: "turbo" })).toThrow(/EXTRACT_EFFORT/);
  });

  it("o ensaio não precisa das chaves", () => {
    expect(loadDryRunConfig({ DATA_DIR_GUIAS: "/tmp/x" })).toMatchObject({ DATA_DIR_GUIAS: "/tmp/x", MODEL_WRITER: "claude-opus-5-5" });
  });
});
