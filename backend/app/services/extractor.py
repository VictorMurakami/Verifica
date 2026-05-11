import requests
from bs4 import BeautifulSoup


def extrair_texto_url(url):

    try:
        response = requests.get(url, timeout=10)

        soup = BeautifulSoup(response.text, "html.parser")

        textos = soup.stripped_strings

        return " ".join(textos)

    except:
        return ""