import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CRON_JOBS, CRON_SCHEDULES } from "./schedules";

const README = fileURLToPath(new URL("../../../README.md", import.meta.url));

describe("cron schedules", () => {
  it("gives every job exactly one schedule in valid 5-field cron syntax", () => {
    expect(CRON_SCHEDULES.map((c) => c.path.replace("/api/cron/", "")).sort()).toEqual([...CRON_JOBS].sort());
    for (const { schedule } of CRON_SCHEDULES) {
      expect(schedule.split(" ")).toHaveLength(5);
    }
    expect(CRON_SCHEDULES.find((c) => c.path === "/api/cron/notifications")?.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
  });

  it("matches the vercel.json-ready block of the README", () => {
    const readme = readFileSync(README, "utf8").replace(/\r\n/g, "\n");
    const block = /<!-- crons:start -->\n```json\n([\s\S]*?)\n```\n<!-- crons:end -->/.exec(readme);
    expect(block).not.toBeNull();
    expect(JSON.parse(block![1])).toEqual({ crons: CRON_SCHEDULES });
  });
});
