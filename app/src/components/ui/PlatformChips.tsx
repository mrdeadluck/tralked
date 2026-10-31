import { Chip } from "./Chip";

export type Platform = "PLAYSTATION" | "XBOX" | "NINTENDO" | "PC";

export const PLATFORM_COLOR: Record<Platform, string> = {
  PLAYSTATION: "var(--ps)",
  XBOX: "var(--xbox)",
  NINTENDO: "var(--nin)",
  PC: "var(--pc)",
};

export function PlatformChips({ platforms }: { platforms: Platform[] }) {
  return (
    <>
      {platforms.map((platform) => (
        <Chip key={platform} color={PLATFORM_COLOR[platform]}>
          {platform}
        </Chip>
      ))}
    </>
  );
}
