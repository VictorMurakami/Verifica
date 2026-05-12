import traceback

from fastapi import APIRouter, HTTPException

from app.services.verifier import verificar

router = APIRouter()


@router.post("/api/analyze")
def analyze(data: dict):
    content = data.get("content") or data.get("texto") or data.get("text")
    url = data.get("url")
    request_id = data.get("id") or data.get("requestId")

    try:
        return verificar(content=content, url=url, request_id=request_id)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except Exception:
        traceback.print_exc()
        raise HTTPException(
            status_code=502,
            detail="Algo deu errado na análise. Tente novamente em instantes.",
        )
