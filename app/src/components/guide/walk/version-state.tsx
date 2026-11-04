"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { chosenVersion, VERSION_PARAM, type Version } from "./versions";

/*
 * Which version of the guide the visitor reads (versions.tsx). Steam by default; the choice is kept
 * in the browser (localStorage, which may be blocked) and in the URL (`?versao=playstation`, with
 * history.replaceState: no navigation), and the URL wins, so a shared link opens the same version.
 *
 * The page is the same for everyone: the server draws Steam, and the root's `data-versao` hides what
 * PlayStation leaves out with CSS. On a full page load an inline script sets it before the first
 * paint, so nothing jumps; the client components (journey, counts, resume point) follow after
 * hydration. On a client navigation the first render already reads the choice.
 */

/** Where the browser keeps the choice: one for every guide (a PS5 player plays on PS5). */
export const VERSION_KEY = "tralked:versao-guia";
const ROOT_ID = "wk-root";

function stored(): string | null {
  try {
    return localStorage.getItem(VERSION_KEY);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

const current = (): Version => chosenVersion(window.location.search, stored());
const onServer = (): Version => "steam";

/** The URL with the version in it (Steam, the default, leaves the parameter out). */
function urlWith(version: Version): string {
  const url = new URL(window.location.href);
  if (version === "playstation") url.searchParams.set(VERSION_PARAM, version);
  else url.searchParams.delete(VERSION_PARAM);
  return url.pathname + url.search + url.hash;
}

function store(version: Version) {
  try {
    localStorage.setItem(VERSION_KEY, version);
  } catch {
    // sem armazenamento local: a escolha fica só na URL
  }
  window.history.replaceState(null, "", urlWith(version));
  listeners.forEach((listener) => listener());
}

/** Before the first paint, the stored or linked choice on the root (same rule as chosenVersion). */
const INLINE_SCRIPT = `(function(){try{var r=document.getElementById(${JSON.stringify(ROOT_ID)});if(!r)return;var q=new URLSearchParams(location.search).get(${JSON.stringify(VERSION_PARAM)});var v=q==="steam"||q==="playstation"?q:null;if(!v){try{v=localStorage.getItem(${JSON.stringify(VERSION_KEY)})==="playstation"?"playstation":"steam"}catch(e){v="steam"}}r.setAttribute("data-versao",v)}catch(e){}})();`;

type VersionState = {
  /** The guide has a PlayStation version. */
  enabled: boolean;
  version: Version;
  choose: (version: Version) => void;
  /** The refs the version being read shows, of `refs`. */
  shownRefs: (refs: readonly string[]) => readonly string[];
};

const ONE_VERSION: VersionState = { enabled: false, version: "steam", choose: () => {}, shownRefs: (refs) => refs };
const VersionContext = createContext<VersionState>(ONE_VERSION);

const subscribeNothing = () => () => undefined;

type VersionProviderProps = {
  /** Refs of the items the PlayStation version leaves out; null when the guide has one version. */
  steamOnly: string[] | null;
  children: ReactNode;
};

/** The page's root (`.wk`): its `data-versao` picks the version the CSS shows. */
export function VersionProvider({ steamOnly, children }: VersionProviderProps) {
  const chosen = useSyncExternalStore(subscribe, current, onServer);
  // false on the server and while hydrating a full page load: the inline script is only in the HTML.
  const clientRender = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const enabled = steamOnly !== null;
  const version: Version = enabled ? chosen : "steam";

  // A choice kept in the browser goes in the URL too, so the address bar shares what is on screen.
  useEffect(() => {
    if (enabled && version === "playstation" && chosenVersion(window.location.search, null) !== version) {
      window.history.replaceState(null, "", urlWith(version));
    }
  }, [enabled, version]);

  const choose = useCallback((next: Version) => store(next), []);
  const value = useMemo<VersionState>(() => {
    if (!enabled) return ONE_VERSION;
    const hidden = new Set(steamOnly);
    return {
      enabled,
      version,
      choose,
      shownRefs: (refs) => (version === "playstation" ? refs.filter((ref) => !hidden.has(ref)) : refs),
    };
  }, [enabled, version, choose, steamOnly]);

  if (!enabled) return <div className="wk">{children}</div>;
  return (
    // The inline script may have set the attribute before hydration: React leaves it be.
    <div className="wk" id={ROOT_ID} data-versao={version} suppressHydrationWarning>
      {clientRender ? null : <script dangerouslySetInnerHTML={{ __html: INLINE_SCRIPT }} />}
      <VersionContext value={value}>{children}</VersionContext>
    </div>
  );
}

/** The version being read (Steam outside a guide with two versions). */
export const useVersion = () => useContext(VersionContext);

/** "Steam | PlayStation", next to the seal. */
export function VersionSwitch() {
  const { enabled, version, choose } = useVersion();
  if (!enabled) return null;
  return (
    <div className="wk-ver tk-cut-b" role="group" aria-label="Qual versão você joga?">
      <button type="button" className="steam" onClick={() => choose("steam")} aria-pressed={version === "steam"}>
        Steam
      </button>
      <button type="button" className="ps" onClick={() => choose("playstation")} aria-pressed={version === "playstation"}>
        PlayStation
      </button>
    </div>
  );
}
