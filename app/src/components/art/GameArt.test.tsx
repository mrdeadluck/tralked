import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GameArt } from "./GameArt";

const HERO = "https://cdn2.steamgriddb.com/hero/393cb2b797b64d4b4ca1c3634deb3345.png";

describe("GameArt (real image)", () => {
  it("asks the CDN for the shown size, with srcset only when sizes is given", () => {
    const { container, rerender } = render(
      <GameArt seed={1} imageUrl="https://images.igdb.com/igdb/image/upload/t_1080p/sc10vlm.jpg" width={224} height={128} />,
    );
    let img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://images.igdb.com/igdb/image/upload/t_screenshot_med/sc10vlm.jpg");
    expect(img.hasAttribute("srcset")).toBe(false);
    expect(img.getAttribute("loading")).toBe("lazy");

    rerender(
      <GameArt seed={1} imageUrl="https://images.igdb.com/igdb/image/upload/t_1080p/sc10vlm.jpg" width={224} height={128} sizes="112px" priority />,
    );
    img = container.querySelector("img")!;
    expect(img.getAttribute("srcset")).toContain("t_screenshot_big/sc10vlm.jpg 889w");
    expect(img.getAttribute("sizes")).toBe("112px");
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("fetchpriority")).toBe("high");
  });

  it("walks the fallbacks of a missing SteamGridDB thumbnail, ending on the original", () => {
    const { container } = render(<GameArt seed={1} imageUrl={HERO} width={400} height={200} sizes="400px" />);
    const src = () => container.querySelector("img")!.getAttribute("src");
    expect(src()).toBe("https://cdn2.steamgriddb.com/hero_thumb/393cb2b797b64d4b4ca1c3634deb3345.jpg");
    fireEvent.error(container.querySelector("img")!);
    expect(src()).toBe("https://cdn2.steamgriddb.com/hero_thumb/393cb2b797b64d4b4ca1c3634deb3345.png");
    // The failed JPEG thumbnail is remembered: the PNG one is now this art's sized copy.
    expect(container.querySelector("img")!.getAttribute("srcset")).not.toContain(".jpg");
    fireEvent.error(container.querySelector("img")!);
    expect(src()).toBe(HERO);
    expect(container.querySelector("img")!.hasAttribute("srcset")).toBe(false);
    fireEvent.error(container.querySelector("img")!);
    expect(src()).toBe(HERO);
  });

  it("asks a remembered PNG-only thumbnail directly on the next render of that art", () => {
    const { container } = render(<GameArt seed={1} imageUrl={HERO} width={400} height={200} />);
    expect(container.querySelector("img")!.getAttribute("src")).toBe(
      "https://cdn2.steamgriddb.com/hero_thumb/393cb2b797b64d4b4ca1c3634deb3345.png",
    );
  });
});
