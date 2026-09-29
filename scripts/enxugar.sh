#!/usr/bin/env bash
# Enxuga o target/ do Rust. O cargo NUNCA recolhe o que ficou para trás: cada
# bump de dependência, troca de branch ou versão de compilador deixa o conjunto
# antigo de artefatos lá para sempre. Em set/2026 isso tinha chegado a 89 GB.
#
#   ./scripts/enxugar.sh          remove o que não é tocado há 10 dias
#   ./scripts/enxugar.sh 30       ...há 30 dias (mais conservador)
#   ./scripts/enxugar.sh tudo     cargo clean, do zero (rebuild de ~15 min)
#   ./scripts/enxugar.sh ver      só mostra o tamanho de hoje, não mexe
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="app/src-tauri/target"
tamanho() { du -sh "$TARGET" 2>/dev/null | cut -f1 || echo "0"; }

case "${1:-10}" in
  ver)
    echo "→ $TARGET: $(tamanho)"
    [[ -d "$TARGET/incremental" ]] && echo "  incremental/: $(du -sh "$TARGET/incremental" | cut -f1)"
    exit 0
    ;;
  tudo)
    echo "→ cargo clean · antes: $(tamanho)"
    cargo clean --manifest-path app/src-tauri/Cargo.toml
    echo "✓ zerado (o próximo build recompila as 762 crates)"
    ;;
  *)
    DIAS="$1"
    # O binário vive em ~/.cargo/bin, que não está no PATH desta máquina — mas
    # o cargo procura subcomando no próprio bin dir, então `cargo sweep` acha.
    if ! cargo sweep --version >/dev/null 2>&1; then
      echo "! falta o cargo-sweep: cargo install cargo-sweep" >&2
      exit 1
    fi
    ANTES=$(tamanho)
    echo "→ varrendo o que não é tocado há $DIAS dias · antes: $ANTES"
    cargo sweep --time "$DIAS" app/src-tauri
    # o incremental/ é cache de recompilação: sempre reconstruível, e é ele que
    # mais incha em dia de muito rebuild.
    if [[ -d "$TARGET/debug/incremental" ]]; then
      find "$TARGET/debug/incremental" -maxdepth 1 -type d -mtime +"$DIAS" -exec rm -rf {} + 2>/dev/null || true
    fi
    echo "✓ $ANTES → $(tamanho)"
    ;;
esac
