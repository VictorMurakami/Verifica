from __future__ import annotations

import os
import json
import logging
from pathlib import Path
from dotenv import load_dotenv
from google import genai

load_dotenv()

logger = logging.getLogger(__name__)

API_KEY = os.getenv("GOOGLE_API_KEY")
MODEL_NAME = os.getenv("MODEL_NAME", "gemini-2.5-flash")

GENERATION_CONFIG = {
    "response_mime_type": "application/json",
    "temperature": 0.2,
    "top_p": 0.9,
    "max_output_tokens": 4096,
}

client = genai.Client(api_key=API_KEY)

CATEGORIAS = [
    "linguagem_alarmista",
    "sem_fonte",
    "dado_sem_referencia",
    "generalizacao",
    "apelo_emocional",
]


PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "verifica.md"
SYSTEM_PROMPT = PROMPT_PATH.read_text(encoding="utf-8")


def _try_close_truncated(texto: str):
    """Tenta recuperar JSON cortado no meio: corta o último item incompleto
    da lista `excerpts` e fecha os colchetes/chaves pendentes."""

    inicio = texto.find("{")
    if inicio < 0:
        return None
    s = texto[inicio:]

    last_complete = s.rfind("},")
    if last_complete < 0:
        return None

    candidate = s[: last_complete + 1] + "]}"
    try:
        return json.loads(candidate)
    except Exception:
        return None


def _parse_json(texto: str):
    if not texto:
        return None

    try:
        return json.loads(texto)
    except Exception:
        pass

    inicio = texto.find("{")
    fim = texto.rfind("}") + 1
    if inicio != -1 and fim > inicio:
        try:
            return json.loads(texto[inicio:fim])
        except Exception:
            pass

    return _try_close_truncated(texto)


def _extract_text_and_meta(response):
    """Extrai texto e finish_reason da resposta do Gemini, sem levantar
    quando o candidato não tem texto válido."""

    content = ""
    finish_reason = None

    try:
        candidates = getattr(response, "candidates", None) or []
        if candidates:
            cand = candidates[0]
            try:
                finish_reason = cand.finish_reason.name
            except Exception:
                finish_reason = str(getattr(cand, "finish_reason", "") or "")

            parts = getattr(getattr(cand, "content", None), "parts", []) or []
            for p in parts:
                txt = getattr(p, "text", "") or ""
                content += txt
    except Exception:
        pass

    if not content:
        try:
            content = response.text or ""
        except Exception:
            content = ""

    return content.strip(), finish_reason


def analisar_texto(texto: str, contexto: str = "", origem_url: str | None = None):
    if not texto and not contexto:
        return {"error": "Cole um texto ou link para que possamos analisar."}

    if origem_url and not contexto:
        return {
            "error": (
                "Não conseguimos ler o conteúdo desta página. "
                "Tente colar o texto da notícia diretamente."
            )
        }

    user_prompt = (
        "TEXTO PARA ANÁLISE:\n"
        f"{texto or '(vazio — use apenas o CONTEXTO)'}\n\n"
        "CONTEXTO ADICIONAL (extraído da URL, se houver):\n"
        f"{contexto or '(nenhum)'}\n\n"
        "Responda APENAS com o JSON definido no formato de saída."
    )

    try:
        response = client.models.generate_content(model=MODEL_NAME, contents=user_prompt)
    except Exception as e:
        logger.warning("erro do gemini: %s", e)
        return {
            "error": "A análise não pôde ser feita agora. Tente novamente em instantes."
        }

    content, finish_reason = _extract_text_and_meta(response)

    if not content:
        logger.warning("modelo sem conteúdo. finish_reason=%s", finish_reason)
        if finish_reason == "SAFETY":
            return {
                "error": (
                    "Este conteúdo foi bloqueado pelos filtros de segurança "
                    "e não pôde ser analisado."
                )
            }
        return {
            "error": "Não conseguimos analisar este texto. Tente reformular ou tente novamente."
        }

    resultado = _parse_json(content)
    if not resultado:
        logger.warning(
            "JSON parse falhou. finish_reason=%s len=%d tail=%r",
            finish_reason, len(content), content[-300:],
        )
        if finish_reason == "MAX_TOKENS":
            return {
                "error": (
                    "O texto é longo demais para uma análise completa. "
                    "Tente colar apenas o trecho mais importante."
                )
            }
        return {
            "error": "Não conseguimos processar o resultado da análise. Tente novamente."
        }

    if "error" in resultado:
        return {"error": str(resultado["error"])[:240]}

    return resultado
