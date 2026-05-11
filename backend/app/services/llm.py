import os
import json
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

API_KEY = os.getenv("GOOGLE_API_KEY")
MODEL_NAME = os.getenv("MODEL_NAME")

genai.configure(api_key=API_KEY)

model = genai.GenerativeModel(MODEL_NAME)


def limpar_json(texto):
    try:
        return json.loads(texto)

    except:
        try:
            inicio = texto.find("{")
            fim = texto.rfind("}") + 1

            if inicio != -1 and fim != -1:
                return json.loads(texto[inicio:fim])

        except:
            pass

    return None


def analisar_texto(texto, contexto=""):

    prompt = f"""
Você é um verificador de fatos rigoroso.

Analise a veracidade da afirmação abaixo.

TEXTO:
{texto}

CONTEXTO:
{contexto}

REGRAS:
- Seja crítico
- Não invente fatos
- Não invente fontes
- Explique claramente
- Retorne apenas JSON

FORMATO:

{{
  "score": número de 0 a 100,
  "classificacao": "Falso, Duvidoso, Parcialmente verdadeiro ou Confiável",
  "explicacao": "explicação objetiva"
}}
"""

    response = model.generate_content(prompt)

    content = response.text.strip()

    resultado = limpar_json(content)

    if resultado:
        return resultado

    return {
        "score": 50,
        "classificacao": "Duvidoso",
        "explicacao": content
    }