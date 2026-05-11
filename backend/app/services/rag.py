import chromadb
from sentence_transformers import SentenceTransformer

client = chromadb.Client()

collection = client.get_or_create_collection("verifica")

model = SentenceTransformer("all-MiniLM-L6-v2")


def adicionar_documentos(textos):

    embeddings = model.encode(textos).tolist()

    for i, texto in enumerate(textos):

        collection.add(
            documents=[texto],
            embeddings=[embeddings[i]],
            ids=[str(i)]
        )


def buscar_contexto(query):

    try:
        embedding = model.encode([query]).tolist()

        results = collection.query(
            query_embeddings=embedding,
            n_results=3
        )

        return results["documents"]

    except:
        return []