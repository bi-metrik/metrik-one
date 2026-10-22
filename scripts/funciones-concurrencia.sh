#!/usr/bin/env bash
# Prueba 8 del diseño de la etapa 2 de Sabor (funciones, cupos y reservas): muchos `apartar` a la vez sobre una
# función de cupo pequeño terminan con ocupadas <= cupo. PGlite (las pruebas de vitest) tiene UNA conexión y no
# puede probar el `select ... for update`; esto sí: N procesos `psql`, cada uno con su conexión, contra un Postgres
# real. Cada uno aparta y SOSTIENE la transacción abierta un rato antes del commit: sin el candado, los demás leen la
# ocupación vieja en ese rato y se sobrevende.
#
# Uso:
#   PGURL=postgres://postgres:postgres@localhost:5432/postgres scripts/funciones-concurrencia.sh [migracion.sql]
# El segundo argumento permite correrla contra una copia de la migración SIN el candado (lo hace el CI) para verla
# fallar: una prueba de concurrencia que nunca se vio fallar no prueba nada.
#
# La base tiene que estar VACÍA: carga el esquema mínimo de prueba y las dos migraciones. Nunca contra producción.
set -euo pipefail

: "${PGURL:?Falta PGURL (una base de Postgres VACÍA y desechable)}"
case "$PGURL" in
  *supabase.co*|*supabase.com*|*pooler*) echo "Esto no se corre contra Supabase." >&2; exit 2 ;;
esac

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
MIGRACION="${1:-$RAIZ/supabase/migrations/20261022170000_modulo_funciones.sql}"
N="${FUNCIONES_N:-40}"
CUPO=5
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

WS=00000000-0000-4000-8000-00000000c001
EQUIPO=00000000-0000-4000-8000-00000000c011
EXP=00000000-0000-4000-8000-00000000c021
F_CUPO=00000000-0000-4000-8000-00000000c051
F_CLAVE=00000000-0000-4000-8000-00000000c052
F_CONF=00000000-0000-4000-8000-00000000c053

psql_q() { psql "$PGURL" -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

psql_q -f "$RAIZ/src/lib/funciones/__fixtures__/esquema-base.sql" >/dev/null
psql_q -f "$RAIZ/supabase/migrations/20261021090000_asistente_chatwoot.sql" >/dev/null
psql_q -f "$MIGRACION" >/dev/null

psql_q >/dev/null <<SQL
insert into workspaces (id, slug) values ('$WS', 'sabor-prueba');
insert into profiles values ('$EQUIPO', '$WS', 'operator');
insert into funcion_experiencias (id, workspace_id, nombre, minutos_apartado) values ('$EXP', '$WS', 'PRUEBA', 30);
insert into funcion_funciones (id, workspace_id, experiencia_id, inicia_at, cupo_total)
  values ('$F_CUPO', '$WS', '$EXP', now() + interval '1 day', $CUPO);
insert into funcion_funciones (id, workspace_id, experiencia_id, inicia_at, cupo_total)
  values ('$F_CLAVE', '$WS', '$EXP', now() + interval '1 day', 8),
         ('$F_CONF', '$WS', '$EXP', now() + interval '1 day', 4);
SQL

# Una sesión del equipo que corre $1 dentro de una transacción y la sostiene 0,2 s antes del commit.
como_equipo() {
  psql "$PGURL" -X -q -t -A -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
select set_config('prueba.uid', '$EQUIPO', false);
set role authenticated;
begin;
$1;
select pg_sleep(0.2);
commit;
SQL
}

falla=0

# ── A. Cupo: N apartados de 1 a la vez sobre cupo 5 ─────────────────────────
for i in $(seq 1 "$N"); do
  ( if como_equipo "select funcion_apartar('$WS', '$F_CUPO', 1, '{}'::jsonb, 'a-$i', 'equipo')"; then
      echo ok > "$TMP/a-$i"; else echo no > "$TMP/a-$i"; fi ) &
done
wait
ok_a=$(grep -l ok "$TMP"/a-* | wc -l | tr -d ' ')
ocupadas=$(psql_q -c "select (funcion_ocupacion('$F_CUPO')->>'ocupadas')::int")
filas=$(psql_q -c "select count(*) from funcion_reservas where funcion_id = '$F_CUPO' and estado = 'apartada'")
echo "A. cupo $CUPO, $N apartados a la vez: $ok_a pasaron, ocupadas $ocupadas, filas $filas"
if [ "$ocupadas" -gt "$CUPO" ] || [ "$filas" -gt "$CUPO" ]; then echo "   SOBREVENTA" >&2; falla=1; fi
if [ "$ok_a" -ne "$CUPO" ] || [ "$ocupadas" -ne "$CUPO" ]; then echo "   se esperaban exactamente $CUPO" >&2; falla=1; fi

# ── B. Idempotencia: la misma clave N veces a la vez = una reserva ─────────────
for i in $(seq 1 10); do
  ( como_equipo "select funcion_apartar('$WS', '$F_CLAVE', 1, '{}'::jsonb, 'misma-clave', 'equipo')" || true ) &
done
wait
misma=$(psql_q -c "select count(*) from funcion_reservas where clave_idempotencia = 'misma-clave'")
echo "B. misma clave 10 veces a la vez: $misma reserva(s)"
if [ "$misma" -ne 1 ]; then falla=1; fi

# ── C. Confirmar a la vez apartados vencidos: solo los que caben ───────────────
# Cupo 4: 4 apartados de 1 que vencen, 4 nuevos que llenan el cupo y 2 de ellos se cancelan. Quedan 2 libres, y los 4
# vencidos se confirman a la vez (el pago llegó tarde): pueden entrar 2, nunca más.
apartar_equipo() {
  psql_q >/dev/null <<SQL
select set_config('prueba.uid', '$EQUIPO', false);
set role authenticated;
select funcion_apartar('$WS', '$F_CONF', 1, '{}'::jsonb, '$1', 'equipo');
SQL
}
for i in 1 2 3 4; do apartar_equipo "viejo-$i"; done
psql_q -c "update funcion_reservas set vence_at = now() - interval '1 minute' where clave_idempotencia like 'viejo-%'" >/dev/null
for i in 1 2 3 4; do apartar_equipo "nuevo-$i"; done
psql_q -c "update funcion_reservas set estado = 'cancelada' where clave_idempotencia in ('nuevo-1', 'nuevo-2')" >/dev/null
mapfile -t viejos < <(psql_q -c "select id from funcion_reservas where clave_idempotencia like 'viejo-%' order by id")
for r in "${viejos[@]}"; do
  ( como_equipo "select funcion_confirmar_pago('$r', 'verificado_manual')" || true ) &
done
wait
confirmadas=$(psql_q -c "select count(*) from funcion_reservas where clave_idempotencia like 'viejo-%' and estado = 'confirmada'")
ocupadas_c=$(psql_q -c "select (funcion_ocupacion('$F_CONF')->>'ocupadas')::int")
echo "C. ${#viejos[@]} apartados vencidos confirmados a la vez con 2 libres: $confirmadas confirmadas, ocupadas $ocupadas_c de 4"
if [ "$ocupadas_c" -gt 4 ]; then echo "   SOBREVENTA al confirmar" >&2; falla=1; fi
if [ "$confirmadas" -ne 2 ]; then echo "   se esperaban exactamente 2" >&2; falla=1; fi

if [ "$falla" -ne 0 ]; then echo "FALLÓ" >&2; exit 1; fi
echo "Sin sobreventa."
