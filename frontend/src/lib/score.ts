export type ScoreBand = "suspicious" | "attention" | "reliable";

export function scoreBand(score: number): ScoreBand {
  if (score <= 30) return "suspicious";
  if (score <= 60) return "attention";
  return "reliable";
}

export const SCORE_LABELS: Record<ScoreBand, string> = {
  suspicious: "Muito Suspeito",
  attention: "Atenção Recomendada",
  reliable: "Aparentemente Confiável",
};
