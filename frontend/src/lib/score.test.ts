import { describe, expect, it } from "vitest";
import { SCORE_LABELS, scoreBand } from "./score";

describe("scoreBand", () => {
  it.each([
    [0, "suspicious", "Muito Suspeito"],
    [30, "suspicious", "Muito Suspeito"],
    [31, "attention", "Atenção Recomendada"],
    [60, "attention", "Atenção Recomendada"],
    [61, "reliable", "Aparentemente Confiável"],
    [100, "reliable", "Aparentemente Confiável"],
  ] as const)("score %d → %s", (score, band, label) => {
    expect(scoreBand(score)).toBe(band);
    expect(SCORE_LABELS[scoreBand(score)]).toBe(label);
  });

  it("classifies a low score (10) as Muito Suspeito", () => {
    expect(scoreBand(10)).toBe("suspicious");
    expect(SCORE_LABELS[scoreBand(10)]).toBe("Muito Suspeito");
  });
});
