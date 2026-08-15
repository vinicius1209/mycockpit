#!/usr/bin/env bash
# Roda um comando com a CPU saturada, para provar que um teste sensível a tempo
# aguenta contenção.
#
# Uso:  scripts/sob-carga.sh [-n SPINNERS] [-t TETO_S] -- <comando...>
# Ex.:  scripts/sob-carga.sh -- cargo test hooks_install
#
# POR QUE ESTE ARQUIVO EXISTE
# --------------------------
# Em 14/08/2026 a versão inline disto deixou 24 laços infinitos órfãos por 13
# horas, queimando ~580% de CPU. O comando terminava com `kill $(jobs -p)`, mas
# essa linha só roda no caminho feliz: o shell foi morto antes de chegar lá e os
# laços viraram filhos do launchd. As consequências foram diagnosticadas como
# outra coisa por horas (agentes travando, "flake induzido por carga").
#
# A lição, que vale além deste script: LIMPEZA QUE DEPENDE DO SUPERVISOR
# SOBREVIVER NÃO É LIMPEZA. Quem gera carga precisa do próprio relógio de morte.
# Por isso aqui há duas camadas independentes:
#   1. `trap ... EXIT INT TERM` — cobre saída normal, Ctrl-C e SIGTERM;
#   2. prazo dentro de cada spinner — cobre o caso em que NADA acima roda,
#      inclusive SIGKILL no pai. Um spinner sem prazo é uma mina terrestre.
# A camada 2 é a que importa: ela não confia em ninguém.

set -euo pipefail

spinners=""
teto=300
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n) spinners="$2"; shift 2 ;;
    -t) teto="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done

if [[ $# -eq 0 ]]; then
  echo "uso: $0 [-n SPINNERS] [-t TETO_S] -- <comando...>" >&2
  exit 2
fi

ncpu=$(sysctl -n hw.ncpu 2>/dev/null || nproc)
: "${spinners:=$((ncpu * 3))}"

pids=()
encerrar() {
  # Camada 1. Roda em qualquer saída deste shell — inclusive falha do comando,
  # porque `set -e` dispara EXIT.
  [[ ${#pids[@]} -gt 0 ]] && kill "${pids[@]}" 2>/dev/null || true
}
trap encerrar EXIT INT TERM

for _ in $(seq 1 "$spinners"); do
  # Camada 2: o prazo mora DENTRO do spinner. Se este shell levar SIGKILL, o
  # trap acima não roda — e mesmo assim o laço morre sozinho ao vencer o teto.
  ( fim=$((SECONDS + teto)); while (( SECONDS < fim )); do :; done ) &
  pids+=($!)
done

echo "carga: ${spinners} spinners em ${ncpu} CPUs, teto de ${teto}s" >&2
sleep 1

status=0
"$@" || status=$?

encerrar
trap - EXIT INT TERM
echo "carga encerrada" >&2
exit "$status"
