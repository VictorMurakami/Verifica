import json
from app.services.extractor import extrair_texto_url
from app.services.rag import buscar_contexto
from app.services.llm import analisar_texto

def verificar(texto, url):
    if url:
        texto = extrair_texto_url(url)

    if not texto:
        return {"erro": "Nenhum conteúdo fornecido"}

    contexto = buscar_contexto(texto[:500])

    resposta_llm = analisar_texto(texto[:1000], contexto)

    try:
        data = json.loads(resposta_llm)
    except:
        return {
            "score": 50,
            "classificacao": "Indeterminado",
            "explicacao": resposta_llm
        }

    return data