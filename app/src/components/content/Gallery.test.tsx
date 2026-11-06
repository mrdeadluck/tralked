import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Gallery } from "./Gallery";

const img = (n: number, credit = "Divulgação/Rockstar Games") => ({
  url: `https://blob.test/${n}.webp`,
  alt: `Captura ${n} de GTA 6`,
  credit,
  creditUrl: "https://www.rockstargames.com/a",
});
const block = { type: "gallery" as const, images: [img(1), img(2), img(3)] };

beforeAll(() => {
  // jsdom has no <dialog> behaviour: open/close as attributes, like the browser.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(cleanup);

describe("Gallery", () => {
  it("a grid of thumbnails with one shared credit linking to the source", () => {
    const { container } = render(<Gallery block={block} />);
    expect(screen.getAllByRole("button", { name: /Ampliar/ })).toHaveLength(3);
    expect(container.querySelector("ul")?.className).toMatch(/grid-cols-2/);
    expect(container.querySelector("ul")?.className).toMatch(/sm:grid-cols-3/);
    const credits = screen.getAllByRole("link", { name: "Divulgação/Rockstar Games" });
    expect(credits).toHaveLength(1);
    expect(credits[0]).toHaveAttribute("href", "https://www.rockstargames.com/a");
  });

  it("different credits are shown per image", () => {
    const { container } = render(<Gallery block={{ type: "gallery", images: [img(1), img(2, "Divulgação/Outra"), img(3)] }} />);
    expect(within(container.querySelector("ul")!).getAllByText(/Divulgação\//)).toHaveLength(3);
    expect(container.querySelector("figure > figcaption")).toBeNull();
  });

  it("a click opens the big image; arrows navigate; Esc closes and focus goes back to the thumbnail", () => {
    render(<Gallery block={block} />);
    const second = screen.getByRole("button", { name: "Ampliar: Captura 2 de GTA 6" });
    second.focus();
    fireEvent.click(second);
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByRole("img", { hidden: true })).toHaveAttribute("src", "https://blob.test/2.webp");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByRole("img", { hidden: true })).toHaveAttribute("src", "https://blob.test/3.webp");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByRole("img", { hidden: true })).toHaveAttribute("src", "https://blob.test/1.webp");
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(within(dialog).getByRole("img", { hidden: true })).toHaveAttribute("src", "https://blob.test/3.webp");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).not.toHaveAttribute("open");
    expect(document.activeElement).toBe(second);
  });
});
