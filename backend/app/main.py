from fastapi import FastAPI
from app.routes.verify import router

app = FastAPI(title="Verifica API")

app.include_router(router)