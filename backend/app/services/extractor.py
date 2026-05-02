import requests
from bs4 import BeautifulSoup

def extrair_texto_url(url: str):
    try:
        r = requests.get(url, timeout=5)
        soup = BeautifulSoup(r.text, "html.parser")
        return soup.get_text(separator=" ", strip=True)
    except:
        return ""