import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { SECURITY_HEADERS } from "./security-headers";

describe("security headers", () => {
  it("are sent on every route", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/:path*", headers: SECURITY_HEADERS }]);
  });

  it("forbid framing, sniffing and plugins without restricting scripts or images", () => {
    const byKey = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(byKey["Content-Security-Policy"]).not.toMatch(/script-src|img-src|default-src|form-action/);
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
  });
});
