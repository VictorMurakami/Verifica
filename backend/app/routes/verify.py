from fastapi import APIRouter
from app.services.verifier import verificar

router = APIRouter()

@router.post("/verificar")
def verificar_info(data: dict):
    texto = data.get("texto")
    url = data.get("url")

    return verificar(texto, url)