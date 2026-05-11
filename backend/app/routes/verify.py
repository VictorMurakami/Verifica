from fastapi import APIRouter
from app.services.verifier import verificar
import traceback

router = APIRouter()

@router.post("/api/analyze")
def verificar_info(data: dict):

    try:
        texto = data.get("texto") or data.get("content") or data.get("text")
        url = data.get("url")

        resultado = verificar(texto, url)

        return resultado

    except Exception as e:
        traceback.print_exc()

        return {
            "reliabilityScore": 0,
            "overallVerdict": f"Erro: {str(e)}",
            "flaggedExcerpts": []
        }