import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UnlockDate } from "./UnlockDate";

describe("UnlockDate", () => {
  afterEach(cleanup);

  it("shows the unlock date as a <time>", () => {
    const { container } = render(<UnlockDate date={new Date("2026-03-12T15:00:00Z")} />);
    const time = container.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe("2026-03-12T15:00:00.000Z");
    expect(time?.textContent).toMatch(/12 de mar\.? de 2026/);
  });

  it("says 'data desconhecida' when the platform gave no date, with no <time>", () => {
    const { container } = render(<UnlockDate date={null} />);
    expect(container.textContent).toBe("data desconhecida");
    expect(container.querySelector("time")).toBeNull();
  });
});
