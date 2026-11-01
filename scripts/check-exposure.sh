#!/usr/bin/env bash
# =============================================================================
# Homelab exposure check
# =============================================================================
# Lists listening sockets and Docker-published ports, and flags high-risk
# services reachable on all interfaces. Exits 1 if any are found.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# Ports that must NEVER be reachable on all interfaces: port -> service.
# This is a deliberate policy list, so it stays hand-written (compose.yml says what is
# published; this says what must not be exposed to the whole LAN/internet).
declare -A RISKY_PORTS=(
    [4000]="rack"          # dashboard; talks to the Docker socket
    [19999]="netdata"      # host metrics, runs with SYS_ADMIN/SYS_PTRACE
    [8181]="filebrowser"   # browses the whole data tree
    [8191]="flaresolverr"  # unauthenticated headless-browser proxy (not published at all today)
)

EXTERNAL_HOST=""
FOUND_RISK=0

usage() {
    cat <<USAGE
Usage: $(basename "$0") [--external HOST] [--help]

Show what the host and Docker expose, and flag risky ports on all interfaces.

  --external HOST   Also run nmap against HOST (your public IP). This must be
                    run from OUTSIDE your LAN (e.g. a VPS or phone hotspot),
                    otherwise the result says nothing about internet exposure.
  -h, --help        Show this help

High-risk ports (RISKY_PORTS in this script): ${!RISKY_PORTS[*]}
Published ports are read from "docker compose config" when docker and jq are available.
Exit status: 1 if a high-risk port is bound to 0.0.0.0 / [::] / *, else 0.
Fix by setting BIND_ADDR in .env to your LAN IP and re-running docker compose up -d.
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --external)
            [[ $# -ge 2 ]] || { echo "--external needs a HOST" >&2; exit 2; }
            EXTERNAL_HOST="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

is_wildcard() {
    case "$1" in
        0.0.0.0|'[::]'|'*'|'::'|':::') return 0 ;;
        *) return 1 ;;
    esac
}

# Print "<addr> <port>" for a local address like 0.0.0.0:8080, [::]:80, *:22
split_addr() {
    local a="$1"
    printf '%s %s\n' "${a%:*}" "${a##*:}"
}

# Print one socket/port line, marked [ALL] when bound to a wildcard address
print_bind() {
    local addr="$1"
    shift
    if is_wildcard "$addr"; then
        echo "  [ALL] $*"
    else
        echo "        $*"
    fi
}

check_risky() {
    local addr="$1" port="$2" where="$3"
    if is_wildcard "$addr" && [[ -n "${RISKY_PORTS[$port]:-}" ]]; then
        echo "  WARNING: ${RISKY_PORTS[$port]} (port $port) is on all interfaces ($where)"
        FOUND_RISK=1
    fi
}

echo "== Host listening sockets =="
if command -v ss >/dev/null 2>&1; then
    # Columns: Netid State Recv-Q Send-Q Local:Port Peer:Port Process
    SOCKETS="$(ss -H -tulpn 2>/dev/null || ss -H -tuln)"
    echo "$SOCKETS" | while read -r proto _ _ _ local _; do
        read -r addr _ < <(split_addr "$local")
        print_bind "$addr" "$proto $local"
    done
    while read -r _ _ _ _ local _; do
        [[ -n "$local" ]] || continue
        read -r addr port < <(split_addr "$local")
        check_risky "$addr" "$port" "host socket"
    done <<<"$SOCKETS"
elif command -v netstat >/dev/null 2>&1; then
    # Columns: Proto Recv-Q Send-Q Local Foreign [State] [PID/Program]
    SOCKETS="$(netstat -tuln 2>/dev/null | awk '$1 ~ /^(tcp|udp)/')"
    while read -r proto _ _ local _; do
        [[ -n "$local" ]] || continue
        read -r addr port < <(split_addr "$local")
        print_bind "$addr" "$proto $local"
        check_risky "$addr" "$port" "host socket"
    done <<<"$SOCKETS"
else
    echo "  neither ss nor netstat found; skipping" >&2
fi

echo
echo "== Docker published ports =="
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    # Ports look like: 0.0.0.0:8080->8080/tcp, [::]:8080->8080/tcp, 192.168.1.10:80->80/tcp
    while IFS=$'\t' read -r name ports; do
        [[ -n "$ports" ]] || continue
        IFS=',' read -ra entries <<<"$ports"
        for entry in "${entries[@]}"; do
            entry="${entry// /}"
            [[ "$entry" == *"->"* ]] || continue
            local_part="${entry%%->*}"
            read -r addr port < <(split_addr "$local_part")
            print_bind "$addr" "$name $entry"
            check_risky "$addr" "$port" "container $name"
        done
    done < <(docker ps --format '{{.Names}}\t{{.Ports}}')
else
    echo "  docker not available or not accessible; skipping" >&2
fi

# Ports published according to compose.yml (all profiles). Sets COMPOSE_PORTS to
# "service host_ip port proto" lines, empty if docker, jq or the config is unavailable.
COMPOSE_PORTS=""
COMPOSE_ENV_NOTE=""
load_compose_ports() {
    command -v docker >/dev/null 2>&1 && command -v jq >/dev/null 2>&1 || return 0
    local env_args=()
    if [[ ! -f "$REPO_DIR/.env" && -f "$REPO_DIR/.env.example" ]]; then
        env_args=(--env-file "$REPO_DIR/.env.example")
        COMPOSE_ENV_NOTE=", no .env found: using .env.example defaults"
    fi
    local json
    json="$(cd "$REPO_DIR" && docker compose "${env_args[@]}" --profile '*' config --format json 2>/dev/null)" || return 0
    COMPOSE_PORTS="$(jq -r '.services | to_entries[] | .key as $s
        | (.value.ports // [])[] | [$s, (.host_ip // "0.0.0.0"), .published, (.protocol // "tcp")] | join(" ")' \
        <<<"$json" 2>/dev/null)" || COMPOSE_PORTS=""
}

echo
echo "== compose.yml published ports =="
load_compose_ports
if [[ -n "$COMPOSE_PORTS" ]]; then
    echo "  (from docker compose config${COMPOSE_ENV_NOTE})"
    while read -r svc addr port proto; do
        [[ -n "$svc" ]] || continue
        print_bind "$addr" "$svc ${addr}:${port}/${proto}"
        check_risky "$addr" "$port" "compose.yml service $svc"
    done <<<"$COMPOSE_PORTS"
else
    echo "  docker compose config unavailable (needs docker and jq); skipping" >&2
fi

if [[ -n "$EXTERNAL_HOST" ]]; then
    echo
    echo "== External scan of $EXTERNAL_HOST =="
    echo "  Note: run this from OUTSIDE your LAN, or the result is meaningless."
    if command -v nmap >/dev/null 2>&1; then
        # Risky ports + SSH/HTTP(S) + every port compose publishes (when readable)
        declare -A SCAN=([22]=1 [80]=1 [443]=1)
        for p in "${!RISKY_PORTS[@]}"; do SCAN[$p]=1; done
        while read -r _ _ p _; do [[ -n "$p" ]] && SCAN[$p]=1; done <<<"$COMPOSE_PORTS"
        PORT_LIST="$(IFS=,; echo "${!SCAN[*]}")"
        nmap -Pn -p "$PORT_LIST" "$EXTERNAL_HOST" || true
    else
        echo "  nmap not installed; skipping" >&2
    fi
fi

echo
if [[ $FOUND_RISK -eq 1 ]]; then
    echo "RESULT: high-risk ports are exposed on all interfaces. Set BIND_ADDR in .env to your LAN IP."
    exit 1
fi
echo "RESULT: no high-risk ports on all interfaces."
