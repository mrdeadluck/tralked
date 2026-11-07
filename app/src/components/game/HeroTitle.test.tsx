import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { optimizedUrl } from "@/lib/images/sized";
import { HeroTitle } from "./HeroTitle";

const LOGO = "https://cdn2.steamgriddb.com/logo/69f5d5c1249e17f4ac1d5b716db47105.png";

afterEach(cleanup);

describe("HeroTitle", () => {
  it("shows a SteamGridDB logo through the optimizer, without high priority, named by its alt", () => {
    const { getByRole } = render(<HeroTitle name="Elden Ring" logoUrl={LOGO} />);
    const img = getByRole("img", { name: "Elden Ring" });
    expect(img.getAttribute("src")).toBe(optimizedUrl(LOGO, 640));
    expect(img.getAttribute("srcset")).toContain(`${optimizedUrl(LOGO, 1200)} 1200w`);
    expect(img.hasAttribute("fetchpriority")).toBe(false);
    expect(getByRole("heading", { level: 1, name: "Elden Ring" })).toBeTruthy();
  });

  it("falls back to the original logo, then to the name in type", () => {
    const { container, getByRole } = render(<HeroTitle name="Elden Ring" logoUrl={LOGO} />);
    fireEvent.error(container.querySelector("img")!);
    const original = container.querySelector("img")!;
    expect(original.getAttribute("src")).toBe(LOGO);
    expect(original.hasAttribute("srcset")).toBe(false);
    fireEvent.error(original);
    expect(container.querySelector("img")).toBeNull();
    expect(getByRole("heading", { level: 1 }).textContent).toBe("Elden Ring");
  });

  it("keeps other logos and the name-only title as they were", () => {
    const steam = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1245620/logo.png";
    const { container, rerender } = render(<HeroTitle name="Elden Ring" logoUrl={steam} />);
    expect(container.querySelector("img")!.getAttribute("src")).toBe(steam);
    rerender(<HeroTitle name="Hades" logoUrl={null} />);
    expect(container.querySelector("h1")!.textContent).toBe("Hades");
  });
});
