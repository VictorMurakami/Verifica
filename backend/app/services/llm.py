import ollama

MODEL = "gemma:latest"  # ou gemma:7b dependendo do que você baixar

def analisar_texto(texto, contexto):
    prompt = f"""
Você é um verificador de fatos.

Analise o texto abaixo:

TEXTO:
{texto}

CONTEXTO:
{contexto}

Responda em JSON:
{{
  "score": 0-100,
  "explicacao": "texto",
  "classificacao": "Falso / Duvidoso / Parcialmente verdadeiro / Confiável"
}}
"""

    response = ollama.chat(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}]
    )

    return response["message"]["content"]