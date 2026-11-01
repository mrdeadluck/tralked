import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GameCoverThumb } from "./GameCoverThumb";

const art = { seed: 1, hues: [200, 230] as [number, number] };

describe("GameCoverThumb", () => {
  it("shows the cover, and nothing (chip) once it fails to load", () => {
    const { container } = render(<GameCoverThumb coverUrl="https://cdn.example.com/c.jpg" variant="chip" {...art} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://cdn.example.com/c.jpg");
    expect(img.getAttribute("alt")).toBe("");
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("falls back to the generated art on a card, without a cover or after an error", () => {
    const none = render(<GameCoverThumb coverUrl={null} variant="card" {...art} />);
    expect(none.container.querySelector("img")).toBeNull();
    expect(none.container.querySelector("canvas")).not.toBeNull();

    const broken = render(<GameCoverThumb coverUrl="https://cdn.example.com/x.jpg" variant="card" {...art} />);
    fireEvent.error(broken.container.querySelector("img")!);
    expect(broken.container.querySelector("img")).toBeNull();
    expect(broken.container.querySelector("canvas")).not.toBeNull();
  });
});
