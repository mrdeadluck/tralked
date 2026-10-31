import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdSlot } from "./AdSlot";

afterEach(cleanup);

describe("AdSlot", () => {
  it("is labelled Publicidade and reserves the leaderboard size by default", () => {
    const { container } = render(<AdSlot />);
    const slot = screen.getByRole("complementary", { name: "Publicidade" });
    expect(slot).toHaveTextContent("Publicidade");
    expect(slot).toHaveAttribute("data-ad-slot", "leaderboard");
    const box = slot.querySelector("[aria-hidden='true']");
    expect(box?.className).toMatch(/h-\[100px\]/);
    expect(box?.className).toMatch(/max-w-\[728px\]/);
    // Nothing from a third party: no script, iframe or external image.
    expect(container.querySelector("script, iframe, img")).toBeNull();
  });

  it("reserves 300x250 for the rectangle", () => {
    render(<AdSlot format="retangulo" />);
    const box = screen.getByRole("complementary", { name: "Publicidade" }).querySelector("[aria-hidden='true']");
    expect(box?.className).toMatch(/h-\[250px\]/);
    expect(box?.className).toMatch(/max-w-\[300px\]/);
  });
});
