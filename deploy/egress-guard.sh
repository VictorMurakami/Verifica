#!/usr/bin/env bash
# Instalado como /usr/local/sbin/verifica-egress-guard (root). Idempotente, sem janela sem a regra.
set -euo pipefail

BRIDGE=br-verifica
CHAIN=VERIFICA-EGRESS
# Faixas Cloudflare (https://www.cloudflare.com/ips-v4, conferidas em 2026-10-16).
CF_RANGES="173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22"

RESTORE=$(cat <<EOF
*filter
:${CHAIN} - [0:0]
-A ${CHAIN} -o ${BRIDGE} -j RETURN
-A ${CHAIN} -d 1.1.1.1/32,1.0.0.1/32 -p udp --dport 53 -j RETURN
-A ${CHAIN} -d 1.1.1.1/32,1.0.0.1/32 -p tcp --dport 53 -j RETURN
-A ${CHAIN} -d ${CF_RANGES} -p tcp -m multiport --dports 443,7844 -j RETURN
-A ${CHAIN} -d ${CF_RANGES} -p udp --dport 7844 -j RETURN
-A ${CHAIN} -j DROP
COMMIT
EOF
)

iptables-restore -w --noflush <<<"$RESTORE"

# Garante uma única cópia da regra na posição 1 sem nunca deixar a chain sem ela:
# insere antes de apagar as sobras (de baixo para cima, por número de linha).
ensure_rule_first() {
  local bin=$1 chain=$2
  shift 2
  local spec="-A ${chain} $*"
  local lines
  lines=$("$bin" -w -S "$chain" | grep -Fxn -- "$spec" | cut -d: -f1 || true)
  if [[ "$(printf '%s\n' "$lines" | grep -c .)" -eq 1 && "$lines" == "2" ]]; then
    return 0
  fi
  "$bin" -w -I "$chain" 1 "$@"
  lines=$("$bin" -w -S "$chain" | grep -Fxn -- "$spec" | cut -d: -f1)
  while IFS= read -r sline; do
    [[ "$sline" == "2" ]] && continue
    "$bin" -w -D "$chain" "$((sline - 1))"
  done < <(printf '%s\n' "$lines" | sort -rn)
}

iptables -w -N DOCKER-USER 2>/dev/null || true
iptables -w -C FORWARD -j DOCKER-USER 2>/dev/null || iptables -w -I FORWARD 1 -j DOCKER-USER

ensure_rule_first iptables DOCKER-USER -i "$BRIDGE" -j "$CHAIN"
ensure_rule_first iptables INPUT -i "$BRIDGE" -j DROP
ensure_rule_first ip6tables INPUT -i "$BRIDGE" -j DROP
ensure_rule_first ip6tables FORWARD -i "$BRIDGE" -j DROP
