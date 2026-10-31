import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ArticleBody } from "./ArticleBody";

afterEach(cleanup);

describe("ArticleBody", () => {
  it("renders Markdown headings and paragraphs", () => {
    render(<ArticleBody markdown={"## Título\n\nTexto **forte**."} />);
    expect(screen.getByRole("heading", { level: 2, name: "Título" })).toBeInTheDocument();
    expect(screen.getByText("forte").tagName).toBe("STRONG");
  });

  it("drops raw HTML instead of injecting it", () => {
    const { container } = render(
      <ArticleBody markdown={'Olá <script>window.hacked = 1</script><img src=x onerror="alert(1)">'} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("onerror");
  });

  it("neutralizes javascript: links", () => {
    render(<ArticleBody markdown="[clique](javascript:alert(1))" />);
    const link = screen.getByText("clique").closest("a");
    expect(link?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  });
});
