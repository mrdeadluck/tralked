export function DiscordCard() {
  return (
    // TODO: link para o convite real do Discord quando existir uma URL.
    <a
      href="#"
      className="flex items-center gap-3.5 rounded-[4px] bg-discord p-[18px] text-white transition-transform duration-200 hover:-translate-y-0.5"
    >
      <span
        aria-hidden="true"
        className="grid size-11 place-items-center rounded-[4px] bg-black/20 font-mono text-xs font-bold"
      >
        DC
      </span>
      <span className="flex-1">
        <b className="block text-[17px] font-extrabold">Comunidade no Discord</b>
        <small className="text-[13.5px]">
          Monte grupos para conquistas co-op
        </small>
      </span>
      <span aria-hidden="true" className="text-xl">
        →
      </span>
    </a>
  );
}
