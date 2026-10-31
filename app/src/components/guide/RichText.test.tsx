import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RichText } from "./RichText";

afterEach(cleanup);

describe("RichText (guide steps and tips)", () => {
  it("renders blocks as React elements, never as HTML", () => {
    const { container } = render(
      <RichText
        text="texto simples"
        blocks={[
          { type: "paragraph", text: "Vá até **Dirtmouth** <img src=x onerror=alert(1)>" },
          { type: "achievement", platform: "steam", apiName: "FALSEHOOD" },
        ]}
        cards={{ "steam:FALSEHOOD": { name: "Falsehood", description: "Derrote o False Knight", globalPct: 60, gameName: "Hollow Knight" } }}
      />,
    );
    expect(screen.getByText("Dirtmouth").tagName).toBe("STRONG");
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(screen.getByText("Falsehood")).toBeInTheDocument();
    expect(screen.queryByText("texto simples")).not.toBeInTheDocument();
  });

  it("falls back to the plain text without blocks", () => {
    render(<RichText text="Fale com o Elderbug." blocks={null} className="tip" />);
    const p = screen.getByText("Fale com o Elderbug.");
    expect(p.tagName).toBe("P");
    expect(p).toHaveClass("tip");
  });
});
