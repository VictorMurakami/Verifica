import { AnalysisResult } from "@/types/analysis";

export const mockResult: AnalysisResult = {
  requestId: "mock-001",
  reliabilityScore: 3,
  overallVerdict:
    "O conteúdo apresenta múltiplos sinais de desinformação, incluindo linguagem alarmista, ausência de fontes verificáveis e generalizações absolutas. Recomenda-se buscar fontes oficiais antes de compartilhar.",
  flaggedExcerpts: [
    {
      excerpt: "URGENTE: Cientistas confirmam que o mundo vai acabar em 2027!",
      reason:
        "Uso de linguagem alarmista com letras maiúsculas e pontuação excessiva para gerar pânico.",
      category: "linguagem_alarmista",
      suggestion:
        "Procure a mesma informação em veículos de imprensa confiáveis como Reuters ou AFP.",
    },
    {
      excerpt: "Estudos comprovam que 99% da população será afetada.",
      reason:
        "Dado estatístico apresentado sem qualquer referência a estudo, instituição ou metodologia.",
      category: "dado_sem_referencia",
      suggestion:
        "Verifique se existe algum estudo publicado em revistas científicas que sustente essa afirmação.",
    },
    {
      excerpt: "Todos os especialistas concordam que não há solução.",
      reason:
        "Generalização absoluta — raramente 100% dos especialistas concordam sobre qualquer tema.",
      category: "generalizacao",
      suggestion:
        "Busque opiniões de diferentes especialistas para ter uma visão mais equilibrada.",
    },
    {
      excerpt: "Se você ama sua família, compartilhe agora antes que seja tarde!",
      reason:
        "Apelo emocional com pressão para compartilhamento imediato, tática comum em fake news.",
      category: "apelo_emocional",
      suggestion:
        "Desconfie de mensagens que pressionam o compartilhamento urgente.",
    },
    {
      excerpt: "A grande mídia esconde isso de você.",
      reason:
        "Afirmação sem fonte que deslegitima veículos de imprensa sem apresentar evidências.",
      category: "sem_fonte",
      suggestion:
        "Verifique se o tema foi coberto por veículos jornalísticos e compare as informações.",
    },
  ],
  analyzedText: "",
};

export function getMockResult(delay = 1500): Promise<AnalysisResult> {
  return new Promise((resolve) => setTimeout(() => resolve(mockResult), delay));
}
