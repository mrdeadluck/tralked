import { pctText } from "@/components/guide/format";
import { SpoilerAchievement } from "./spoilers";
import type { AchView } from "./view";

/*
 * "Só na Steam — sem roteiro ainda": a guide written from the PSN list (scope psn, R22) lists the
 * Steam achievements it has no route for, honestly, with no how-to. Name, description, icon and
 * rarity come from the Steam list; a hidden one arrives without them (view.ts) and its name is
 * fetched only when the reader asks.
 */

export function SteamOnlyList({ achievements }: { achievements: AchView[] }) {
  if (achievements.length === 0) return null;
  return (
    <section id="g-so-steam" className="wk-sec wk-sost" aria-labelledby="g-so-steam-h">
      <p className="wk-lbl">Fora do roteiro</p>
      <h2 id="g-so-steam-h">Só na Steam — sem roteiro ainda</h2>
      <p className="wk-sost-note">
        Estas conquistas existem só na versão Steam e ficaram fora deste guia, que segue a lista da PSN; quando o
        guia Steam completo sair, elas entram.
      </p>
      <ul className="wk-sost-list">
        {achievements.map((a) => (
          <li key={a.id} className="wk-sost-row">
            {a.iconUrl && !a.hidden ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.iconUrl} alt="" width={40} height={40} loading="lazy" />
            ) : (
              <span className="noimg" aria-hidden="true" />
            )}
            <div>
              {a.hidden || a.name === null ? (
                <>
                  <p>Conquista oculta</p>
                  <b>
                    <SpoilerAchievement id={`steam-only-${a.id}`} achievementId={a.id} name={null} what="a conquista oculta" />
                  </b>
                </>
              ) : (
                <>
                  <b>{a.name}</b>
                  {a.description ? <p>{a.description}</p> : null}
                </>
              )}
            </div>
            <small>{pctText(a.globalPct)} dos jogadores</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
