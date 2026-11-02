import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CoverArt } from "./CoverArt";

const COVER = { url: "https://img.example/cover.jpg", wide: false };
const HERO = { url: "https://img.example/hero.jpg", wide: true };

describe("CoverArt", () => {
  it("fills a wide box with wide art when the game has some", () => {
    const { container } = render(<CoverArt name="Mafia" sources={[COVER, HERO]} ratio="16 / 10" />);
    const img = container.querySelector("img:not(.cva-wash)")!;
    expect(img.getAttribute("src")).toBe(HERO.url);
    expect(img.classList.contains("cva-img")).toBe(true);
  });

  it("stages the portrait cover in a wide box only when there is no wide art", () => {
    const { container } = render(<CoverArt name="Mafia" sources={[COVER]} ratio="16 / 10" />);
    expect(container.querySelector(".cva-cover")!.getAttribute("src")).toBe(COVER.url);
  });

  it("keeps the given order in a portrait box", () => {
    const { container } = render(<CoverArt name="Mafia" sources={[COVER, HERO]} ratio="1 / 1.38" />);
    expect(container.querySelector(".cva-img")!.getAttribute("src")).toBe(COVER.url);
  });
});
