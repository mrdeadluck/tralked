import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VerifyPanel } from "./VerifyPanel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const actions = vi.hoisted(() => ({
  startVerificationAction: vi.fn(async () => ({ ok: true as const, code: "TRK-ABC234", expiresAt: "2026-11-03T12:00:00Z" })),
  checkVerificationAction: vi.fn(async (): Promise<unknown> => ({ ok: true, handle: "Lucas-Exemplo" })),
  cancelVerificationAction: vi.fn(async () => ({ ok: true as const })),
  // ClaimPanel (shared steps) imports these too.
  startClaimAction: vi.fn(),
  confirmClaimAction: vi.fn(),
  cancelClaimAction: vi.fn(),
}));
vi.mock("@/lib/accounts/actions", () => actions);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VerifyPanel (Verificar agora)", () => {
  it("offers to verify an unverified connection", async () => {
    const onNotice = vi.fn();
    render(<VerifyPanel platform="psn" handle="Lucas-Exemplo" verification={null} onNotice={onNotice} />);
    expect(screen.getByText(/Sobre mim/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Verificar conta" })));
    expect(actions.startVerificationAction).toHaveBeenCalledWith({ platform: "psn" });
  });

  it("pendente: shows the code, where to paste it and Verificar agora", async () => {
    const onNotice = vi.fn();
    render(
      <VerifyPanel
        platform="xbox"
        handle="Lucas Exemplo"
        verification={{ code: "TRK-ABC234", expiresLabel: "3 de nov., 12:00", failure: null }}
        onNotice={onNotice}
      />,
    );
    expect(screen.getByText("TRK-ABC234")).toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.getByText(/Personalizar perfil → Bio/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Verificar agora" })));
    expect(actions.checkVerificationAction).toHaveBeenCalledWith({ platform: "xbox" });
    expect(onNotice).toHaveBeenLastCalledWith({ tone: "ok", text: expect.stringContaining("verificada") });
  });

  it("falhou: says why; a refusal that is not about the profile becomes a notice", async () => {
    const onNotice = vi.fn();
    render(
      <VerifyPanel
        platform="retro"
        handle="LucasExemplo"
        verification={{ code: "TRK-ABC234", expiresLabel: "3 de nov., 12:00", failure: "O código não está no Motto." }}
        onNotice={onNotice}
      />,
    );
    expect(screen.getByText("Falhou")).toBeInTheDocument();
    expect(screen.getByText("O código não está no Motto.")).toBeInTheDocument();

    actions.checkVerificationAction.mockResolvedValueOnce({ ok: false, reason: "too_soon", retryAfterSec: 20, error: "Aguarde 20 segundos antes de tentar de novo." });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Verificar agora" })));
    expect(onNotice).toHaveBeenLastCalledWith({ tone: "error", text: "Aguarde 20 segundos antes de tentar de novo." });

    // The reason of a failed read comes back with the refreshed page, not as a second message.
    actions.checkVerificationAction.mockResolvedValueOnce({ ok: false, reason: "code_missing", error: "x" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Verificar agora" })));
    expect(onNotice).toHaveBeenLastCalledWith(null);
  });
});
