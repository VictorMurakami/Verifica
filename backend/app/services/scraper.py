import requests
from bs4 import BeautifulSoup


def extract_text_from_url(url: str):

    try:
        response = requests.get(url, timeout=5)

        soup = BeautifulSoup(
            response.text,
            "html.parser"
        )

        paragraphs = [
            p.get_text()
            for p in soup.find_all("p")
        ]

        text = " ".join(paragraphs)

        return text[:3000]

    except Exception:
        return ""