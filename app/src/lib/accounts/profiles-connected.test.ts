import { describe, expect, it } from "vitest";
import { readConnectedProfile } from "./profiles";

// Offline fixtures (no credentials in tests, STEAM_MODE=fixture): the same adapters the sync uses.
describe("readConnectedProfile (Verificar agora)", () => {
  it("reads Steam by SteamID64 and gives the Resumo", async () => {
    await expect(readConnectedProfile("steam", { externalId: "76561198000000042", handle: "nome-antigo" })).resolves.toMatchObject({
      externalId: "76561198000000042",
      text: expect.stringContaining("TRK-STEAM2"),
      isPrivate: false,
    });
  });

  it("reads PSN by online id and gives the Sobre mim", async () => {
    await expect(readConnectedProfile("psn", { externalId: "x", handle: "lucas-exemplo" })).resolves.toMatchObject({
      handle: "Lucas-Exemplo",
      text: "Caçador de platinas.",
    });
    await expect(readConnectedProfile("psn", { externalId: "x", handle: "Ninguem-Aqui" })).resolves.toBeNull();
  });

  it("reads Xbox by XUID, without the gamertag", async () => {
    await expect(
      readConnectedProfile("xbox", { externalId: "2535400000000001", handle: "gamertag antiga" }),
    ).resolves.toEqual({ externalId: "2535400000000001", handle: "Lucas Exemplo", text: "Gamerscore é vida.", isPrivate: false });
    await expect(readConnectedProfile("xbox", { externalId: "1", handle: "Lucas Exemplo" })).resolves.toBeNull();
  });

  it("reads RetroAchievements by user, then by ULID when the user was renamed", async () => {
    const ulid = "01JTRALKED00000000000LUCAS";
    await expect(readConnectedProfile("retro", { externalId: ulid, handle: "LucasExemplo" })).resolves.toMatchObject({
      externalId: ulid,
      text: "Hardcore ou nada.",
    });
    await expect(readConnectedProfile("retro", { externalId: ulid, handle: "NomeAntigo" })).resolves.toMatchObject({
      externalId: ulid,
      handle: "LucasExemplo",
    });
  });
});
