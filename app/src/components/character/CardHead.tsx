import type { ReactNode } from "react";
import { PanelHead } from "./Panel";

type CardHeadProps = {
  title: string;
  /** Texto discreto à direita (ex.: "1 escudo"). */
  aside?: ReactNode;
};

/** Cabeçalho de card da ficha do personagem: o mesmo cabeçalho condensado dos painéis. */
export function CardHead({ title, aside }: CardHeadProps) {
  return <PanelHead title={title} aside={aside} />;
}
