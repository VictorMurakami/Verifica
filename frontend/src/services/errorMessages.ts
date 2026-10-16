export const NETWORK_ERROR = "Sem conexão com o Verifica. Verifique sua internet e tente de novo.";
export const GENERIC_ERROR = "Algo deu errado na análise. Tente novamente em instantes.";
export const TURNSTILE_FAILED = "Não conseguimos confirmar seu acesso. Recarregue a página e tente de novo.";
export const TURNSTILE_UNAVAILABLE =
  "A verificação de segurança não carregou. Desative bloqueadores para este site e recarregue a página.";

export const STATUS_MESSAGES: Record<number, string> = {
  400: "Não entendemos o pedido. Recarregue a página e tente de novo.",
  403: TURNSTILE_FAILED,
  413: "O conteúdo enviado é grande demais. Cole só o trecho principal da notícia.",
  429: "Muitas análises em pouco tempo. Espere um pouco e tente de novo.",
  502: "O Verifica está fora do ar agora. Tente de novo em alguns minutos.",
  503: "Muita gente usando o Verifica agora. Tente de novo em um minuto.",
  504: "A análise demorou demais. Tente novamente em instantes.",
};
