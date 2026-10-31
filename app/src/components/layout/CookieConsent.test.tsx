import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consentCookie, CONSENT_COOKIE, optionalAllowed, readConsent } from "@/lib/consent";
import { CookieConsent, CookiePreferences } from "./CookieConsent";

function clearConsent() {
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`;
}

beforeEach(clearConsent);
afterEach(() => {
  cleanup();
  clearConsent();
});

describe("consent cookie helpers", () => {
  it("reads only valid choices of the consent cookie", () => {
    expect(readConsent("")).toBeNull();
    expect(readConsent("a=1; tk_consent=all; b=2")).toBe("all");
    expect(readConsent("tk_consent=necessary")).toBe("necessary");
    expect(readConsent("tk_consent=tudo")).toBeNull();
    expect(readConsent("xtk_consent=all")).toBeNull();
  });

  it("writes a first-party, one-year, SameSite=Lax cookie (Secure on https)", () => {
    expect(consentCookie("necessary", false)).toBe("tk_consent=necessary; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(consentCookie("all", true)).toMatch(/; Secure$/);
  });

  it("allows optional cookies only after an explicit yes", () => {
    expect(optionalAllowed(null)).toBe(false);
    expect(optionalAllowed("necessary")).toBe(false);
    expect(optionalAllowed("all")).toBe(true);
  });
});

describe("CookieConsent banner", () => {
  it("shows until a choice is made, then remembers it in the cookie", () => {
    render(<CookieConsent />);
    const banner = screen.getByRole("region", { name: "Aviso de cookies" });
    expect(banner).toHaveTextContent("só os cookies necessários");
    expect(screen.getByRole("link", { name: "Como usamos cookies" })).toHaveAttribute("href", "/privacidade#cookies");
    act(() => fireEvent.click(screen.getByRole("button", { name: "Só os necessários" })));
    expect(screen.queryByRole("region", { name: "Aviso de cookies" })).not.toBeInTheDocument();
    expect(readConsent(document.cookie)).toBe("necessary");
  });

  it("stays hidden when the visitor already chose", () => {
    document.cookie = "tk_consent=all; Path=/";
    render(<CookieConsent />);
    expect(screen.queryByRole("region", { name: "Aviso de cookies" })).not.toBeInTheDocument();
  });

  it("the privacy page preferences change the choice and hide the banner", () => {
    render(
      <>
        <CookieConsent />
        <CookiePreferences />
      </>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("ainda não escolheu");
    act(() => fireEvent.click(screen.getAllByRole("button", { name: "Aceitar opcionais" })[1]));
    expect(readConsent(document.cookie)).toBe("all");
    expect(screen.queryByRole("region", { name: "Aviso de cookies" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("aceitou cookies opcionais");
    expect(screen.getByRole("button", { name: "Aceitar opcionais" })).toHaveAttribute("aria-pressed", "true");
  });
});
