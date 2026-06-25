#!/usr/bin/env bash
# Smoke test ZERO-setup: mostra os tipos de evento que o `claude` emite,
# sem precisar compilar nada. Requer: claude CLI autenticado + jq.
#
# Uso:  ./smoke.sh ["seu prompt aqui"]
set -euo pipefail

PROMPT="${1:-List the files here and summarize the project.}"
OUT="/tmp/mycockpit-stream.jsonl"

echo "▶ claude -p (stream-json) — prompt: $PROMPT"
echo "──────────────────────────────────────────────────────────"

claude -p "$PROMPT" \
  --output-format stream-json \
  --verbose \
  --allowedTools "Read,Glob,Grep" \
  | tee "$OUT" \
  | jq -rc 'select(.type) | {type, subtype: (.subtype // null), event: (.event.type // null)}'

echo "──────────────────────────────────────────────────────────"
echo "Stream cru salvo em: $OUT"
echo "Contagem por tipo de evento:"
jq -rc '.type' "$OUT" | sort | uniq -c
echo
echo "session_id (se houver):"
jq -rc 'select(.session_id) | .session_id' "$OUT" | head -n1
