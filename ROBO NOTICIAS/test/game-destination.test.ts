import { describe, expect, it } from "vitest";
import { gameDestination } from "../src/game-destination.js";

const LE = { slug: "mass-effect-legendary-edition", name: "Mass Effect Legendary Edition" };

describe("gameDestination", () => {
  it("sends Mass Effect 1, 2 and 3, any edition, by name or slug, to the Legendary Edition", () => {
    for (const game of [
      "Mass Effect",
      "Mass Effect 2",
      "Mass Effect 3",
      "Mass Effect II",
      "Mass Effect (2007)",
      "Mass Effect 2: Collector's Edition",
      "Mass Effect 3 Edição Digital Deluxe N7 (2012)",
      "Mass Effect Legendary Edition",
      "mass-effect",
      "mass-effect-2-2010-edition",
      "mass-effect-3-n7-collectors-edition",
      "mass-effect-polish-collectors-edition",
    ]) {
      expect(gameDestination(game), game).toEqual(LE);
    }
  });

  it("leaves Andromeda, the spin-offs and other games where they are", () => {
    for (const game of [
      "Mass Effect: Andromeda",
      "mass-effecttm-andromeda",
      "Mass Effect™: Andromeda",
      "Mass Effect: Corsair",
      "mass-effect-team-assault",
      "Mass Effect 4",
      "Dragon Age: The Veilguard",
      "Massive Effect",
    ]) {
      expect(gameDestination(game), game).toBeNull();
    }
  });
});
