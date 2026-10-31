import type { FamilyLibraryEntry } from "@/lib/family/service";
import { FamilyGameTile } from "./FamilyGameTile";

/** "Quase lá da família": expects the already filtered list from `almostThere()`. */
export function FamilyAlmost({ entries }: { entries: FamilyLibraryEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="pt-5 text-muted">
        Nenhum jogo perto do 100% ainda. Quando alguém da família passar de 70% em um jogo, ele aparece aqui.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-5 pt-5">
      {entries.map((entry) => (
        <FamilyGameTile key={entry.game.id} entry={entry} />
      ))}
    </div>
  );
}
