#!/usr/bin/env bash
# Prueba 8 del diseño de la etapa 2 de Sabor (funciones, cupos y mapa del salón): muchos `apartar` a la vez sobre una
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
MIGRACION="${1:-$RAIZ/supabase/migrations/20261021120000_modulo_funciones.sql}"
N="${FUNCIONES_N:-40}"
CUPO=5
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

WS=00000000-0000-4000-8000-00000000c001
EQUIPO=00000000-0000-4000-8000-00000000c011
EXP=00000000-0000-4000-8000-00000000c021
MONTAJE=00000000-0000-4000-8000-00000000c031
M1=00000000-0000-4000-8000-00000000c041
M2=00000000-0000-4000-8000-00000000c042
F_CUPO=00000000-0000-4000-8000-00000000c051
F_MESAS=00000000-0000-4000-8000-00000000c052

psql_q() { psql "$PGURL" -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

psql_q -f "$RAIZ/src/lib/funciones/__fixtures__/esquema-base.sql" >/dev/null
psql_q -f "$RAIZ/supabase/migrations/20261021090000_asistente_chatwoot.sql" >/dev/null
psql_q -f "$MIGRACION" >/dev/null

psql_q >/dev/null <<SQL
insert into workspaces (id, slug) values ('$WS', 'sabor-prueba');
insert into profiles values ('$EQUIPO', '$WS', 'operator');
insert into funcion_experiencias (id, workspace_id, nombre, minutos_apartado) values ('$EXP', '$WS', 'PRUEBA', 30);
insert into funcion_montajes (id, workspace_id, experiencia_id, nombre) values ('$MONTAJE', '$WS', '$EXP', 'PRUEBA');
insert into funcion_mesas (id, workspace_id, montaje_id, etiqueta, puestos) values
  ('$M1', '$WS', '$MONTAJE', 'M1', 4), ('$M2', '$WS', '$MONTAJE', 'M2', 4);
insert into funcion_funciones (id, workspace_id, experiencia_id, inicia_at, cupo_total)
  values ('$F_CUPO', '$WS', '$EXP', now() + interval '1 day', $CUPO);
insert into funcion_funciones (id, workspace_id, experiencia_id, montaje_id, inicia_at, cupo_total)
  values ('$F_MESAS', '$WS', '$EXP', '$MONTAJE', now() + interval '1 day', 8);
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
  ( como_equipo "select funcion_apartar('$WS', '$F_MESAS', 1, '{}'::jsonb, 'misma-clave', 'equipo')" || true ) &
done
wait
misma=$(psql_q -c "select count(*) from funcion_reservas where clave_idempotencia = 'misma-clave'")
echo "B. misma clave 10 veces a la vez: $misma reserva(s)"
if [ "$misma" -ne 1 ]; then falla=1; fi

# ── C. Mesa: 8 reservas de 1 se sientan a la vez en M1 (4 puestos) ─────────────
for i in $(seq 1 7); do
  psql_q >/dev/null <<SQL
select set_config('prueba.uid', '$EQUIPO', false);
set role authenticated;
select funcion_apartar('$WS', '$F_MESAS', 1, '{}'::jsonb, 'c-$i', 'equipo');
SQL
done
mapfile -t reservas < <(psql_q -c "select id from funcion_reservas where funcion_id = '$F_MESAS' order by id")
for r in "${reservas[@]}"; do
  ( como_equipo "select funcion_asignar_mesas('$r', '[{\"mesa_id\": \"$M1\", \"personas\": 1}]'::jsonb)" || true ) &
done
wait
en_m1=$(psql_q -c "select coalesce(sum(personas), 0) from funcion_reserva_mesas where mesa_id = '$M1' and funcion_id = '$F_MESAS'")
echo "C. ${#reservas[@]} reservas a la mesa M1 (4 puestos) a la vez: $en_m1 sentadas"
if [ "$en_m1" -gt 4 ]; then echo "   MESA SOBREVENDIDA" >&2; falla=1; fi
if [ "$en_m1" -ne 4 ]; then echo "   se esperaban exactamente 4" >&2; falla=1; fi

if [ "$falla" -ne 0 ]; then echo "FALLÓ" >&2; exit 1; fi
echo "Sin sobreventa."
