# Verifica

Verificador de fatos com IA. Backend em **FastAPI** (Gemini + RAG com ChromaDB) e frontend em **Next.js 16** com Tailwind + daisyUI.

```
.
├── backend/      # API FastAPI (Python)
├── frontend/     # Aplicação Next.js (TypeScript)
├── docker-compose.yml
└── package.json  # scripts utilitários para subir tudo junto
```

---

## Pré-requisitos

- **Node.js 20+** e npm
- **Python 3.11+** e pip
- (opcional) **Docker** + **Docker Compose**
- Uma chave da [Google AI Studio](https://aistudio.google.com/app/apikey) para o Gemini

---

## Configuração rápida (1ª vez)

Clone e copie os arquivos de exemplo de variáveis de ambiente:

```bash
git clone <repo-url> verifica
cd verifica

cp .env.example backend/.env
cp .env.example frontend/.env.local
```

Edite `backend/.env` e preencha sua `GOOGLE_API_KEY`.

Instale as dependências do backend e frontend de uma vez:

```bash
npm install        # instala concurrently na raiz
npm run setup      # cria venv do Python e instala libs do front
```

> O `setup` faz: cria `backend/.venv`, instala `requirements.txt`, roda `npm install` em `frontend/`.

---

## Subindo tudo junto (front + back)

```bash
npm run dev
```

Isso usa `concurrently` para rodar:

- Backend em `http://localhost:8000` (FastAPI com reload)
- Frontend em `http://localhost:3000` (Next.js dev)

Pressione `Ctrl+C` uma vez para encerrar ambos.

### Rodar separadamente

```bash
npm run dev:backend     # só a API
npm run dev:frontend    # só o front
```

---

## Variáveis de ambiente

### Backend (`backend/.env`)

| Variável         | Descrição              | Exemplo            |
| ---------------- | ---------------------- | ------------------ |
| `GOOGLE_API_KEY` | Chave da API do Gemini | `AIza...`          |
| `MODEL_NAME`     | Modelo Gemini a usar   | `gemini-2.5-flash` |

### Frontend (`frontend/.env.local`)

| Variável              | Descrição              | Exemplo                 |
| --------------------- | ---------------------- | ----------------------- |
| `NEXT_PUBLIC_API_URL` | URL pública do backend | `http://localhost:8000` |

Referência completa: [`.env.example`](.env.example).

---

## Docker (subida única)

Para subir front + back em containers:

```bash
cp backend/.env.example backend/.env   # garanta sua chave aqui
docker compose up --build
```

Ou via npm:

```bash
npm run docker:up
npm run docker:down
```

Serviços expostos:

- `http://localhost:8000` — API
- `http://localhost:3000` — frontend

O volume `./backend/data` é montado para persistir o índice vetorial local.

---

## Build de produção (sem Docker)

```bash
npm run build:frontend
npm run start:frontend     # serve o build em :3000

# backend
cd backend
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

## Endpoints principais

`POST /api/analyze`

```json
{
  "texto": "Texto a verificar",
  "url": "https://opcional.com/artigo"
}
```

Resposta:

```json
{
  "reliabilityScore": 0,
  "overallVerdict": "Classificação: explicação",
  "flaggedExcerpts": []
}
```

---

## Arquitetura e Componentes Centrais

### Backend (`/backend`)
- **`app/services/llm.py`**: Gerencia a comunicação com o Google Gemini. Contém a lógica de construção do prompt, tratamento de erros da API, parsing de JSON resiliente e proteções contra *prompt injection*.
- **`app/services/scraper.py`**: Responsável por extrair o conteúdo textual de URLs fornecidas, utilizando `trafilatura` e `BeautifulSoup` para limpar o HTML e remover ruídos (anúncios, menus).
- **`app/prompts/verifica.md`**: Prompt principal do agente, contendo todas as instruções de comportamento, categorias de análise e exemplos de saída.
- **`app/prompts/verifica_compact.md`**: Versão otimizada e mais curta do prompt, usada para reduzir o consumo de tokens e acelerar a resposta.

### Frontend (`/frontend`)
- **`src/app/page.tsx`**: Ponto de entrada da aplicação web. Gerencia o estado global da página, o formulário de entrada e a renderização condicional dos resultados e animações.

---

## Troubleshooting

- **`GOOGLE_API_KEY` ausente** → preencha em `backend/.env`.
- **Erro ao instalar `sentence-transformers`** → garanta Python 3.11+; em macOS pode precisar `xcode-select --install`.
- **CORS no front** → backend já libera `*`; verifique se `NEXT_PUBLIC_API_URL` aponta para `http://localhost:8000`.
