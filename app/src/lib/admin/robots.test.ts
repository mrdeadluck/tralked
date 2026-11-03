import { describe, expect, it } from "vitest";
import { INGESTION_KINDS, ingestionKindView } from "./robots";

describe("ingestion log kinds", () => {
  it("each kind has its own label and editor link (none for images)", () => {
    expect(ingestionKindView("article", "a1")).toEqual({ label: "Notícia", href: "/admin/noticias/a1" });
    expect(ingestionKindView("guide", "g1")).toEqual({ label: "Guia", href: "/admin/guias/g1" });
    expect(ingestionKindView("guide_request", "r1")).toEqual({ label: "Pedido de guia", href: "/admin/guias/pedidos" });
    expect(ingestionKindView("media", "m1")).toEqual({ label: "Imagem", href: null });
    expect(ingestionKindView("other", "x")).toEqual({ label: "other", href: null });
    expect(ingestionKindView("guide", null).href).toBeNull();
  });

  it("the filter offers every kind the API logs", () => {
    expect([...INGESTION_KINDS]).toEqual(["article", "guide", "guide_request", "media"]);
  });
});
