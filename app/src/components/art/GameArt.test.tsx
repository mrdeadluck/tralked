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

  it("drops the optimizer copies, keeping the CDN thumbnail, when the one in use fails", () => {
    // Its own id: other tests teach the module that HERO's JPEG thumbnail fails.
    const hero = "https://cdn2.steamgriddb.com/hero/0a1b2c3d4e5f60718293a4b5c6d7e8f9.png";
    const { container } = render(<GameArt seed={1} imageUrl={hero} width={1280} height={640} sizes="100vw" priority />);
    let img = container.querySelector("img")!;
    expect(img.getAttribute("srcset")).toContain("/_next/image?url=");
    expect(img.getAttribute("src")).toContain("/_next/image?url=");
    // The browser picked the 1200 px optimizer copy from the srcset and it failed.
    const picked = `http://localhost/_next/image?url=${encodeURIComponent(hero)}&w=1200&q=75`;
    Object.defineProperty(img, "currentSrc", { value: picked, configurable: true });
    fireEvent.error(img);
    img = container.querySelector("img")!;
    expect(img.hasAttribute("srcset")).toBe(false);
    // Not the 3840 px PNG: the CDN's own JPEG thumbnail, which did not fail.
    expect(img.getAttribute("src")).toBe(hero.replace("/hero/", "/hero_thumb/").replace(".png", ".jpg"));
  });
});
