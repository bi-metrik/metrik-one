#!/bin/bash
# Chat de prueba del núcleo conversacional en la terminal (ver chat.ts). Usa SOLO la llave «Gemini API Key (pruebas)»,
# leída con un grep dirigido a .credentials.md; nunca se imprime. Argumentos: [--tope 0.30] [--guion]
CREDENCIALES="${CREDENCIALES:-$HOME/Developer/metrik/.credentials.md}"
if [[ " $* " != *" --guion "* ]]; then
  export GEMINI_API_KEY="$(grep -m1 'Gemini API Key (pruebas)' "$CREDENCIALES" | awk -F'|' '{gsub(/ /,"",$3); print $3}')"
  [ ${#GEMINI_API_KEY} -gt 20 ] || { echo "No encontré la llave de pruebas en $CREDENCIALES"; exit 2; }
fi
cd "$(dirname "$0")/../../../../.." && exec deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/chat.ts "$@"
