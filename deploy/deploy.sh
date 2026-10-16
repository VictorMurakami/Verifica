#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f deploy/compose.yml)
MARKER=/home/kami/.verifica-deploy-failed

fail() {
  echo "$1" >&2
  "${COMPOSE[@]}" down
  touch "$MARKER"
  exit 1
}

is_ipv4() {
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]
}

ALLOW_BRANCH=0
if [[ "${1:-}" == "--allow-branch" ]]; then
  ALLOW_BRANCH=1
  shift
fi
REF="${1:-origin/master}"

if [[ ! -f deploy/.env ]]; then
  echo "deploy/.env ausente (copie de deploy/.env.example)" >&2
  exit 1
fi
if [[ "$(stat -c %a deploy/.env)" != "600" ]]; then
  echo "deploy/.env precisa de chmod 600" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain -- . ':!deploy/.env')" ]]; then
  echo "árvore de trabalho suja (fora de deploy/.env): resolva antes do deploy" >&2
  exit 1
fi

git fetch --prune origin

git rev-parse --verify --end-of-options "${REF}^{commit}" >/dev/null
if [[ "$ALLOW_BRANCH" -eq 0 ]] && ! git merge-base --is-ancestor "$REF" origin/master; then
  echo "$REF não é ancestral de origin/master; use --allow-branch para forçar" >&2
  exit 1
fi

if ! cmp -s <(git show "$REF:deploy/egress-guard.sh") /usr/local/sbin/verifica-egress-guard; then
  echo "firewall instalado diverge do guard em $REF: reinstale deploy/egress-guard.sh em /usr/local/sbin/verifica-egress-guard" >&2
  exit 1
fi
if ! systemctl is-active --quiet verifica-egress.service; then
  echo "verifica-egress.service inativo: instale o firewall antes do deploy" >&2
  exit 1
fi
if ! systemctl is-active --quiet verifica-egress-refresh.timer; then
  echo "verifica-egress-refresh.timer inativo: instale o firewall antes do deploy" >&2
  exit 1
fi

git checkout --detach "$REF"
"${COMPOSE[@]}" pull tunnel
"${COMPOSE[@]}" build --pull backend
"${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout 90

BRIDGE_NAME="$(docker network inspect verifica_verifica_net -f '{{index .Options "com.docker.network.bridge.name"}}')" || fail "não foi possível inspecionar a rede verifica_verifica_net"
if [[ "$BRIDGE_NAME" != "br-verifica" ]]; then
  fail "rede verifica_verifica_net sem bridge br-verifica (encontrado: $BRIDGE_NAME)"
fi

GW="$(ip route show default | awk '/default/ {print $3; exit}')" || fail "não foi possível descobrir o gateway"
HOST_IP="$(ip route get 1.1.1.1 | awk '{for (i=1;i<=NF;i++) if ($i=="src") print $(i+1)}' | head -n1)" || fail "não foi possível descobrir o IP do host"
is_ipv4 "$GW" || fail "não foi possível descobrir um gateway IPv4 válido (encontrado: $GW)"
is_ipv4 "$HOST_IP" || fail "não foi possível descobrir um IP de host IPv4 válido (encontrado: $HOST_IP)"

WAN="$(curl -4fsS -m 5 https://api.ipify.org)" || fail "não foi possível descobrir o IP público via ipify"
is_ipv4 "$WAN" || fail "resposta do ipify não é um IPv4 válido (encontrado: $WAN)"

if ! "${COMPOSE[@]}" exec -T backend python - "$GW" "$HOST_IP" "$WAN" <<'PY'
import socket
import sys

gateway_ip, host_ip, public_ip = sys.argv[1:4]

targets = [
    (gateway_ip, 80, False),
    (gateway_ip, 443, False),
    (host_ip, 22, False),
    (host_ip, 8123, False),
    (host_ip, 1883, False),
    ("9.9.9.9", 443, False),
    ("172.31.250.1", 22, False),
    ("172.17.0.1", 22, False),
    (public_ip, 80, False),
    (public_ip, 443, False),
    ("1.1.1.1", 80, False),
    ("openrouter.ai", 443, True),
]

failed = False
for host, port, should_connect in targets:
    try:
        socket.create_connection((host, port), 3).close()
        connected = True
    except OSError:
        connected = False
    ok = connected == should_connect
    print(f"{host}:{port} connected={connected} expected={should_connect} {'OK' if ok else 'FAIL'}")
    if not ok:
        failed = True

sys.exit(1 if failed else 0)
PY
then
  fail "teste de isolamento de rede falhou: alvo proibido alcançado ou openrouter.ai inacessível"
fi

"${COMPOSE[@]}" ps
git log -1 --oneline
rm -f "$MARKER"
