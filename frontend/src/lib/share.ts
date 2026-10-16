import { AnalysisResult } from "@/types/analysis";
import { SCORE_LABELS, scoreBand } from "./score";
import { SITE_URL } from "./site";

export function shareText(result: AnalysisResult): string {
  const label = SCORE_LABELS[scoreBand(result.reliabilityScore)];
  return `Analisei no Verifica: ${result.reliabilityScore}% · ${label}. Confira em ${SITE_URL.href}`;
}
