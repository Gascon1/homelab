#!/usr/bin/env bash
# =============================================================================
# Homelab exposure check
# =============================================================================
# Lists listening sockets and Docker-published ports, and flags high-risk
# services reachable on all interfaces. Exits 1 if any are found.
# =============================================================================

set -euo pipefail

# High-risk ports: port -> service
declare -A RISKY=(
    [4000]="rack"
    [19999]="netdata"
    [8191]="flaresolverr"
    [8181]="filebrowser"
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

High-risk ports: ${!RISKY[*]}
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

check_risky() {
    local addr="$1" port="$2" where="$3"
    if is_wildcard "$addr" && [[ -n "${RISKY[$port]:-}" ]]; then
        echo "  WARNING: ${RISKY[$port]} (port $port) is on all interfaces ($where)"
        FOUND_RISK=1
    fi
}

echo "== Host listening sockets =="
if command -v ss >/dev/null 2>&1; then
    # Columns: Netid State Recv-Q Send-Q Local:Port Peer:Port Process
    SOCKETS="$(ss -H -tulpn 2>/dev/null || ss -H -tuln)"
    echo "$SOCKETS" | while read -r proto _ _ _ local _; do
        read -r addr port < <(split_addr "$local")
        if is_wildcard "$addr"; then
            echo "  [ALL] $proto $local"
        else
            echo "        $proto $local"
        fi
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
        if is_wildcard "$addr"; then
            echo "  [ALL] $proto $local"
        else
            echo "        $proto $local"
        fi
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
            if is_wildcard "$addr"; then
                echo "  [ALL] $name $entry"
            else
                echo "        $name $entry"
            fi
            check_risky "$addr" "$port" "container $name"
        done
    done < <(docker ps --format '{{.Names}}\t{{.Ports}}')
else
    echo "  docker not available or not accessible; skipping" >&2
fi

if [[ -n "$EXTERNAL_HOST" ]]; then
    echo
    echo "== External scan of $EXTERNAL_HOST =="
    echo "  Note: run this from OUTSIDE your LAN, or the result is meaningless."
    if command -v nmap >/dev/null 2>&1; then
        PORT_LIST="$(IFS=,; echo "${!RISKY[*]}"),22,80,443,2283,5055,7878,8080,8989,9696,32400"
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
