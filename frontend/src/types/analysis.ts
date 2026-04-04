export type InputType = "text" | "url";

export type ExcerptCategory =
  | "linguagem_alarmista"
  | "sem_fonte"
  | "dado_sem_referencia"
  | "generalizacao"
  | "apelo_emocional";

export interface AnalysisRequest {
  id: string;
  inputType: InputType;
  content: string;
  timestamp: string;
}

export interface FlaggedExcerpt {
  excerpt: string;
  reason: string;
  category: ExcerptCategory;
  suggestion: string;
}

export interface AnalysisResult {
  requestId: string;
  reliabilityScore: number;
  overallVerdict: string;
  flaggedExcerpts: FlaggedExcerpt[];
  analyzedText: string;
}
