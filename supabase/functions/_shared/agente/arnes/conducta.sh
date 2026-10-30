#!/bin/bash
# Evaluación de conducta del asistente con el modelo real (2026-10-29), sobre la rama y sobre main con el MISMO script.
# Llaves: la de Anthropic la pega Mauricio (read -rs, no queda en el historial ni en pantalla); la de Gemini es SOLO la
# de PRUEBAS, línea 78 de .credentials.md, y se verifica por huella (sha256 empieza por 6d1d75dc). Ninguna se imprime.
# Uso: arnes/conducta.sh <dir-del-repo-de-la-rama> <dir-del-repo-main | -> [--k 3] [--salida <dir>] (con «-», solo la rama)
set -u
RAMA="$1"; MAIN="$2"; shift 2
K=3; SALIDA="${TMPDIR:-/tmp}/conducta-$(date +%Y%m%d-%H%M%S)"
while [ $# -gt 0 ]; do
  case "$1" in
    --k) K="$2"; shift 2 ;;
    --salida) SALIDA="$2"; shift 2 ;;
    *) echo "argumento desconocido: $1"; exit 2 ;;
  esac
done
CREDENCIALES="${CREDENCIALES:-$HOME/Developer/metrik/.credentials.md}"
GEMINI_API_KEY="$(sed -n 78p "$CREDENCIALES" | awk -F'|' '{gsub(/ /,"",$3); print $3}')"
case "$(printf %s "$GEMINI_API_KEY" | sha256sum)" in
  6d1d75dc*) ;;
  *) echo "La línea 78 no es la llave de pruebas de Gemini (huella distinta): no sigo."; exit 2 ;;
esac
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  read -rs -p "Pega la llave de Anthropic (no se ve) y Enter: " ANTHROPIC_API_KEY; echo
fi
[ ${#ANTHROPIC_API_KEY} -gt 20 ] || { echo "Llave de Anthropic vacía."; exit 2; }
export GEMINI_API_KEY ANTHROPIC_API_KEY
mkdir -p "$SALIDA"
ARNES=supabase/functions/_shared/agente/arnes
for LADO in rama main; do
  DIR="$RAMA"; [ "$LADO" = main ] && DIR="$MAIN"
  [ "$DIR" = - ] && continue
  echo "== $LADO ($DIR) =="
  (cd "$DIR" && deno run -A --node-modules-dir=none "$ARNES/conducta.ts" --k "$K" --salida "$SALIDA/$LADO") | tee "$SALIDA/$LADO.jsonl"
  # El prompt común también le llega al dominio ONE (gastos, ingresos): su arnés de siempre, con Haiku y sin respaldo.
  (cd "$DIR" && deno run -A --node-modules-dir=none "$ARNES/one.ts" --salida "$SALIDA/$LADO-one") > "$SALIDA/$LADO-one.log" 2>&1
  tail -n 15 "$SALIDA/$LADO-one.log"
done
echo "Resultados en $SALIDA"
