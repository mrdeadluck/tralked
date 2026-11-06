import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { XPostEmbed } from "./XPostEmbed";

const block = {
  type: "post" as const,
  network: "x" as const,
  url: "https://x.com/bethesda/status/1850000000000000001",
  authorName: "Bethesda",
  authorHandle: "bethesda",
  text: "The next chapter of The Elder Scrolls.",
  postedAt: "2026-11-03T17:00:00.000Z",
};

const xScripts = () => document.querySelectorAll('script[src*="platform.twitter.com"]');
const setConsent = (value: string) => {
  document.cookie = `tk_consent=${value}; path=/`;
};

afterEach(() => {
  cleanup();
  for (const s of xScripts()) s.remove();
  document.cookie = "tk_consent=; path=/; max-age=0";
});

describe("XPostEmbed", () => {
  it("with necessary cookies only: the stored post, a load button, a link to X, and no X script", () => {
    setConsent("necessary");
    render(<XPostEmbed block={block} />);
    expect(xScripts()).toHaveLength(0);
    expect(screen.getByText(block.text)).toBeInTheDocument();
    expect(screen.getByText("Bethesda")).toBeInTheDocument();
    expect(screen.getByText("@bethesda")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Carregar post" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir no X" })).toHaveAttribute("href", block.url);
    expect(screen.getByText(/3 de nov\. de 2026/)).toBeInTheDocument();
  });

  it("the button loads the X script for this post only", async () => {
    setConsent("necessary");
    render(<XPostEmbed block={block} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Carregar post" }));
    });
    expect(xScripts()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Carregar post" })).toBeNull();
    const fallback = screen.getByRole("link", { name: "Abrir no X" });
    expect(fallback).toHaveAttribute("href", block.url);
    expect(fallback.closest("figcaption")?.textContent).toBe("Não carregou? Abrir no X");
  });

  it("with all cookies accepted the script loads without a click, once per page", async () => {
    setConsent("all");
    await act(async () => {
      render(
        <>
          <XPostEmbed block={block} />
          <XPostEmbed block={{ ...block, url: "https://x.com/bethesda/status/2" }} />
        </>,
      );
    });
    expect(xScripts()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Carregar post" })).toBeNull();
    // The stored post stays until X draws its own.
    expect(screen.getAllByText(block.text)).toHaveLength(2);
  });
});
