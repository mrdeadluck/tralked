import type { Metadata } from "next";
import { ReleasesList } from "@/components/releases/ReleasesList";

export const metadata: Metadata = {
  title: "Lançamentos de jogos | Tralked",
  description: "Os jogos que acabaram de sair e os próximos lançamentos de PC (Steam), PlayStation, Xbox e Nintendo.",
  alternates: { canonical: "/lancamentos" },
};

/** Default view: latest releases on PC (Steam first, as on the home card). */
export default function LancamentosPage() {
  return <ReleasesList tab="ultimos" filter="PC" />;
}
