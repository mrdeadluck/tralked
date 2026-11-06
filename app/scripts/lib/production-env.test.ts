import { describe, expect, it } from "vitest";
import { productionTarget } from "./production-env";

describe("productionTarget", () => {
  it("reads CRON_SECRET and APP_URL, quoted or not", () => {
    expect(productionTarget('# comment\nCRON_SECRET="s3cr3t"\nAPP_URL=https://tralked.com/\nOTHER=x\n')).toEqual({
      CRON_SECRET: "s3cr3t",
      APP_URL: "https://tralked.com",
    });
    expect(productionTarget("CRON_SECRET=abc\r\n").APP_URL).toBe("https://tralked.com");
  });

  it("refuses a missing secret and a dev APP_URL, without echoing values", () => {
    expect(() => productionTarget("APP_URL=https://tralked.com")).toThrow(/CRON_SECRET/);
    for (const url of ["http://tralked.com", "https://localhost:3000", "https://127.0.0.1", "https://box.local", "nope"]) {
      let message = "";
      try {
        productionTarget(`CRON_SECRET=hidden-value\nAPP_URL=${url}`);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/APP_URL/);
      expect(message).not.toContain("hidden-value");
    }
  });
});
