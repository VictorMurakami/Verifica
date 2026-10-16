import { describe, expect, it } from "vitest";
import { AnalysisResult } from "@/types/analysis";
import { shareText } from "./share";
import { SITE_URL } from "./site";

function resultWithScore(score: number): AnalysisResult {
  return {
    requestId: "req-1",
    reliabilityScore: score,
    overallVerdict: "Veredicto qualquer.",
    flaggedExcerpts: [],
    analyzedText: "",
  };
}

describe("shareText", () => {
  it.each([
    [10, "Muito Suspeito"],
    [45, "Atenção Recomendada"],
    [95, "Aparentemente Confiável"],
  ] as const)("builds the share text for score %d", (score, label) => {
    const text = shareText(resultWithScore(score));
    expect(text).toBe(`Analisei no Verifica: ${score}% · ${label}. Confira em ${SITE_URL.href}`);
    expect(text).toContain("https://verifica.kaorabr.com/");
  });
});
