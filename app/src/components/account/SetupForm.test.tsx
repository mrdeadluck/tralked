import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupForm } from "./SetupForm";

type Result =
  | { ok: true; setup: { platforms: string[]; pc: Record<string, string> | null } }
  | { ok: false; error: string; field?: string };

const updateSetup = vi.fn<(input: unknown) => Promise<Result>>();
vi.mock("@/app/conta/setup/actions", () => ({ updatePlayerSetupAction: (input: unknown) => updateSetup(input) }));

beforeEach(() => updateSetup.mockReset());
afterEach(cleanup);

describe("SetupForm", () => {
  it("filters the platform list and keeps the marked ones while filtered", () => {
    render(<SetupForm platforms={["ps5"]} pc={null} />);
    expect(screen.getByRole("checkbox", { name: /^PlayStation 5,\s?2020$/ })).toBeChecked();

    fireEvent.change(screen.getByLabelText("Buscar plataforma"), { target: { value: "nintendinho" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("checkbox", { name: /NES \(Nintendinho\)/ }));
    // The PS5 is hidden by the search but still marked (and removable from the strip).
    expect(screen.getByRole("button", { name: "Desmarcar PlayStation 5" })).toBeInTheDocument();
    expect(screen.getByText("Alterações não salvas.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Buscar plataforma"), { target: { value: "zzz" } });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText(/Nenhuma plataforma com/)).toBeInTheDocument();
  });

  it("saves the marked platforms and the spec sheet, then shows the stored values", async () => {
    updateSetup.mockResolvedValue({ ok: true, setup: { platforms: ["ps5", "pc"], pc: { gpu: "RTX 4070" } } });
    render(<SetupForm platforms={["ps5"]} pc={null} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /PC \(Windows ou Linux\)/ }));
    fireEvent.change(screen.getByLabelText("Placa de vídeo"), { target: { value: "  RTX 4070 " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar setup" }));

    await screen.findByText(/Setup salvo/);
    expect(updateSetup).toHaveBeenCalledWith({
      platforms: ["ps5", "pc"],
      pc: expect.objectContaining({ gpu: "  RTX 4070 ", cpu: "" }),
    });
    expect(screen.getByLabelText("Placa de vídeo")).toHaveValue("RTX 4070");
    expect(screen.queryByText("Alterações não salvas.")).not.toBeInTheDocument();
  });

  it("shows the server's error and marks the field", async () => {
    updateSetup.mockResolvedValue({ ok: false, error: "Placa de vídeo: HTML não é permitido.", field: "pc.gpu" });
    render(<SetupForm platforms={[]} pc={{ gpu: "<b>x</b>" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Salvar setup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("HTML");
    await waitFor(() => expect(screen.getByLabelText("Placa de vídeo")).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByLabelText("Placa de vídeo")).toHaveFocus();
  });
});
