#!/bin/bash
# QA con el modelo real de la tanda del 2026-10-12 (códigos pegados, respaldo estricto, extracción compacta). Usa SOLO la
# llave «Gemini API Key (pruebas)», leída con un grep dirigido a .credentials.md; nunca se imprime. Datos inventados.
# Uso: arnes/qa-real.sh [--n 3] [--salida <dir>]
#   1. humo: una llamada mínima; si Google sigue en 403 («Lightning dunning…») o 429, para ahí.
#   2. extracción: los casos de extraccion-casos.ts con el esquema de hoy y el compacto, intercalados (--n veces cada uno).
#      Encender `agente_config.extraccion_compacta` solo si la compacta tiene los mismos aciertos y los mismos campos
#      exigidos llenos, 0 omitidos, y menos ms.
#   3. conversación: conjunto 1 del arnés (incluye c1-1009, con la extracción real) con el respaldo estricto de hoy.
#   4. perfil del contacto (2026-10-12): el conjunto `perfil` (incluye cp-mixto, con la extracción real). Desde esta
#      tanda todos los casos corren con las fichas del perfil (`conPerfil`), como quedará Trappvel al publicarlas.
CREDENCIALES="${CREDENCIALES:-$HOME/Developer/metrik/.credentials.md}"
export GEMINI_API_KEY="$(grep -m1 'Gemini API Key (pruebas)' "$CREDENCIALES" | awk -F'|' '{gsub(/ /,"",$3); print $3}')"
[ ${#GEMINI_API_KEY} -gt 20 ] || { echo "No encontré la llave de pruebas en $CREDENCIALES"; exit 2; }
N=1; SALIDA="${TMPDIR:-/tmp}/qa-agente-$(date +%Y%m%d-%H%M%S)"
while [ $# -gt 0 ]; do
  case "$1" in
    --n) N="$2"; shift 2 ;;
    --salida) SALIDA="$2"; shift 2 ;;
    *) echo "argumento desconocido: $1"; exit 2 ;;
  esac
done
mkdir -p "$SALIDA"
cd "$(dirname "$0")/../../../../.." || exit 2
ARNES=supabase/functions/_shared/agente/arnes
deno run -A --node-modules-dir=none "$ARNES/correr.ts" --humo --salida "$SALIDA" || { echo "El humo falló: no sigo (¿facturación de Google?)."; exit 1; }
deno run -A --node-modules-dir=none "$ARNES/extraccion-casos.ts" --n "$N" --esquema ambas | tee "$SALIDA/extraccion.jsonl"
deno run -A --node-modules-dir=none "$ARNES/correr.ts" --conjunto 1 --salida "$SALIDA"
# 4. perfil del contacto (brief 2026-10-12): explícito, con quién viaja, ambiguo, sin autorización, sensible, juicio y mixto.
deno run -A --node-modules-dir=none "$ARNES/correr.ts" --conjunto perfil --salida "$SALIDA/perfil"
echo "Resultados en $SALIDA"
