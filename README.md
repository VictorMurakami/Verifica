# Verifica

Verificador de indícios de desinformação com IA. Backend em **FastAPI** (Gemma 4 via OpenRouter, pago, com teto de preço por requisição) e frontend em **Next.js 16** exportado como site estático, servido por um **Cloudflare Worker** em `verifica.kaorabr.com`.

```
navegador ─► Cloudflare Worker (assets + /api: Turnstile, rate limit)
                 │  binding Workers VPC + gateway key
                 ▼
           túnel "verifica" (sem hostname público) ─► servidor doméstico
                                                       backend (Docker isolado)
```

```
.
├── backend/   # API FastAPI (Python 3.11)
├── frontend/  # Next.js (export estático) + worker/ (gateway Cloudflare)
├── deploy/    # compose de produção, firewall e script de deploy
└── scripts/   # utilitários de dev
```

## Pré-requisitos

- Node.js 22+ e npm
- Python 3.11
- Docker (para gerar locks e testar a imagem)
- Uma chave do [OpenRouter](https://openrouter.ai/keys)

## Desenvolvimento

```bash
cp backend/.env.example backend/.env            # preencha OPENROUTER_API_KEY
cp frontend/.env.example frontend/.env.development.local   # só o next dev lê
npm install
npm run setup     # venv do backend (deps com hash) + npm install do front
npm run dev       # backend :8000 + frontend :3000
```

Em dev o backend roda com `ENV=development`: CORS liberado para `localhost:3000`, `/docs` ativo e sem gateway key. O front usa a sitekey de teste do Turnstile.

## Testes

```bash
npm test                 # backend (pytest) + frontend (vitest)
cd frontend && npm run lint && npm run typecheck
```

## Limites e proteções

| Camada | Proteção |
|---|---|
| Worker | método/rota, body ≤ 32 KB, `Origin`, 3 req/min por IP, Turnstile |
| Workers VPC | backend sem endereço público; só o Worker chega, por dentro do túnel |
| Backend | gateway key, schema, SSRF guard, cache 24 h, 2 chamadas simultâneas, 15/min, 10/dia por IP, 200/dia no total |
| Servidor | saída só para a Cloudflare (allowlist); LAN, host e IP público bloqueados; download de páginas no Worker |

O backend não sobe com modelo fora da allowlist, com teto de preço fora de 0,01–1 USD por milhão de tokens, nem com segredos de exemplo (`troque-…`).

## Dependências do backend

Edite `backend/requirements.in` e recompile os locks com hash:

```bash
docker run --rm -v "$PWD/backend":/w -w /w python:3.11-slim sh -c "pip install -q pip-tools && pip-compile -q --generate-hashes --strip-extras --allow-unsafe -o requirements.txt requirements.in && pip-compile -q --generate-hashes --strip-extras --allow-unsafe -o requirements-dev.txt requirements-dev.in"
```

## Deploy

### Backend (servidor)

Uma vez, com `sudo`:

```bash
sudo install -m 0755 -o root -g root /opt/verifica/deploy/egress-guard.sh /usr/local/sbin/verifica-egress-guard
sudo install -m 0644 -o root -g root /opt/verifica/deploy/verifica-egress.service /opt/verifica/deploy/verifica-egress-refresh.service /opt/verifica/deploy/verifica-egress-refresh.timer /opt/verifica/deploy/verifica.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now verifica-egress.service verifica-egress-refresh.timer
```

Sempre que `deploy/egress-guard.sh` mudar, reinstale a cópia em `/usr/local/sbin` (o `deploy.sh` recusa o deploy se as duas divergirem):

```bash
sudo install -m 0755 -o root -g root /opt/verifica/deploy/egress-guard.sh /usr/local/sbin/verifica-egress-guard
```

Crie `deploy/.env` (a partir de `deploy/.env.example`, `chmod 600`) e habilite `verifica.service` sem `--now` (ele sobe o compose com `--no-build`, e ainda não existe imagem construída):

```bash
sudo systemctl enable verifica.service
```

A cada versão:

```bash
/opt/verifica/deploy/deploy.sh                                # origin/master
/opt/verifica/deploy/deploy.sh --allow-branch origin/<branch>  # ref fora de origin/master
```

O primeiro `deploy.sh` constrói a imagem e sobe o compose; a partir daí, o boot usa `verifica.service` com `--no-build`.

### Imagens

As imagens do backend (`python:3.11-slim`) e do túnel (`cloudflare/cloudflared`) são fixadas por digest no `backend/Dockerfile` e no `deploy/compose.yml`: não há patch automático. Para atualizar:

```bash
docker buildx imagetools inspect python:3.11-slim
docker buildx imagetools inspect cloudflare/cloudflared:<versão>
```

Troque o digest correspondente no `Dockerfile`/`compose.yml`, commit e rode o `deploy.sh`.

`docker compose config` e `docker inspect` mostram segredos em claro; use `docker compose -f deploy/compose.yml config --no-interpolate` para inspecionar sem vazar valores.

Risco aceito: o volume `verifica-data` não tem cota de disco própria (guarda só o cache de até 2 000 linhas e os contadores de cota); os logs têm rotação (`max-size`/`max-file` no compose).

Se um `deploy.sh` for reprovado (falha de descoberta de IP/gateway ou do teste de isolamento), ele derruba o compose e marca `/home/kami/.verifica-deploy-failed`: `verifica.service` não sobe nesse ref no boot até o marcador ser apagado. Para recuperar: corrija o problema e rode o `deploy.sh` de novo — ao passar, ele apaga o marcador sozinho.

### Frontend + Worker

```bash
cd frontend
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<sitekey> npm run deploy
npx wrangler secret put TURNSTILE_SECRET   # e GATEWAY_KEY
```

### Operação

- Workers VPC está em beta. Se mudar ou passar a custar: hostname público + Access, sem o binding `ORIGIN`, com `ORIGIN_URL` público e os secrets `ACCESS_CLIENT_ID`/`ACCESS_CLIENT_SECRET` (o Worker já suporta).
- Consumo do OpenRouter: `GET https://openrouter.ai/api/v1/key`.
- Trocar de modelo: editar `ALLOWED_MODELS` em `backend/app/core/config.py` (código, não só `.env`), ajustar `MODEL_NAME` em `deploy/.env` e revisar o teto de preço (`LLM_MAX_PROMPT_PRICE`/`LLM_MAX_COMPLETION_PRICE`) antes do `deploy.sh`.
- A chave `verifica` no OpenRouter tem limite de crédito de US$0,05 com reset diário (meia-noite UTC); se estourar, o site mostra que o limite de análises de hoje foi atingido até o reset.
