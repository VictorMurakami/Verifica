from app.services.llm import analisar_texto
from app.services.scraper import extract_text_from_url


def verificar(texto, url=None):

    if not texto and not url:
        return {
            "reliabilityScore": 0,
            "overallVerdict": "Nenhum conteúdo fornecido",
            "flaggedExcerpts": []
        }

    contexto = ""

    if url:
        contexto = extract_text_from_url(url)

    resultado = analisar_texto(texto, contexto)

    score = resultado.get("score", 0)

    classificacao = resultado.get(
        "classificacao",
        "Desconhecido"
    )

    explicacao = resultado.get(
        "explicacao",
        ""
    )

    return {
        "reliabilityScore": score,
        "overallVerdict": f"{classificacao}: {explicacao}",
        "flaggedExcerpts": []
    }