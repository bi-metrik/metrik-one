#!/usr/bin/env bash
# Prueba 8 del diseño de la etapa 2 de Sabor (funciones, cupos y reservas): muchos `apartar` a la vez no sobrevenden,
# con los DOS límites de la función (el del asistente y la capacidad). PGlite (las pruebas de vitest) tiene UNA conexión
# y no puede probar el `select ... for update`; esto sí: N procesos `psql`, cada uno con su conexión, contra un Postgres
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
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

WS=00000000-0000-4000-8000-00000000c001
EQUIPO=00000000-0000-4000-8000-00000000c011
EXP=00000000-0000-4000-8000-00000000c021
CAMP=00000000-0000-4000-8000-00000000c031
F_DOS=00000000-0000-4000-8000-00000000c051
F_CLAVE=00000000-0000-4000-8000-00000000c052
F_CONF=00000000-0000-4000-8000-00000000c053
F_PAGO=00000000-0000-4000-8000-00000000c054
F_OTRA=00000000-0000-4000-8000-00000000c055

psql_q() { psql "$PGURL" -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

psql_q -f "$RAIZ/src/lib/funciones/__fixtures__/esquema-base.sql" >/dev/null
psql_q -f "$RAIZ/supabase/migrations/20261021090000_asistente_chatwoot.sql" >/dev/null
psql_q -f "$MIGRACION" >/dev/null

psql_q >/dev/null <<SQL
insert into workspaces (id, slug) values ('$WS', 'sabor-prueba');
insert into profiles values ('$EQUIPO', '$WS', 'operator');
insert into funcion_experiencias (id, workspace_id, nombre) values ('$EXP', '$WS', 'PRUEBA');
insert into funcion_campanas (id, workspace_id, experiencia_id, nombre, codigo, estado, agenda_publicada_at, minutos_apartado, precio_persona, abono_persona)
  values ('$CAMP', '$WS', '$EXP', 'PRUEBA', 'PRUEBA-1', 'activa', now(), 30, 100000, 40000);
insert into funcion_funciones (id, workspace_id, campana_id, inicia_at, capacidad, cupo_asistente) values
  ('$F_DOS', '$WS', '$CAMP', now() + interval '1 day', 7, 5),
  ('$F_CLAVE', '$WS', '$CAMP', now() + interval '1 day 1 hour', 8, 8),
  ('$F_CONF', '$WS', '$CAMP', now() + interval '1 day 2 hours', 4, 4),
  ('$F_PAGO', '$WS', '$CAMP', now() + interval '1 day 3 hours', 3, 3),
  ('$F_OTRA', '$WS', '$CAMP', now() + interval '1 day 4 hours', 10, 10);
insert into chatwoot_consentimientos (workspace_id, cuenta_id, conversacion_id, canal, tipo, respuesta, texto_clave, texto_version, texto_huella)
  select '$WS', 1, g, 'instagram', 'general', 'si', 'rf.autorizacion', 'v1', repeat('a', 64) from generate_series(1, $N) g
  union all
  select '$WS', 1, g, 'instagram', 'general', 'si', 'rf.autorizacion', 'v1', repeat('a', 64) from generate_series(101, 102) g;
SQL

# Una sesión que corre $2 dentro de una transacción y la sostiene 0,2 s antes del commit.
#   $1 = equipo | asistente
en_transaccion() {
  local rol uid
  if [ "$1" = equipo ]; then rol=authenticated; uid=$EQUIPO; else rol=service_role; uid=''; fi
  psql "$PGURL" -X -q -t -A -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
select set_config('prueba.uid', '$uid', false);
set role $rol;
begin;
$2;
select pg_sleep(0.2);
commit;
SQL
}

apartar_equipo() {
  psql_q >/dev/null 2>&1 <<SQL
select set_config('prueba.uid', '$EQUIPO', false);
set role authenticated;
select funcion_apartar('$WS', '$1', 1, 'total', '{}'::jsonb, '$2', 'equipo');
SQL
}

falla=0

# ── A. Dos límites: N apartados del ASISTENTE a la vez sobre cupo_asistente 5 y capacidad 7 ──────────────
for i in $(seq 1 "$N"); do
  ( if en_transaccion asistente "select funcion_apartar('$WS', '$F_DOS', 1, 'total', '{\"canal\": \"instagram\", \"chatwoot_cuenta_id\": 1, \"chatwoot_conversacion_id\": $i}'::jsonb, 'a-$i', 'asistente')"; then
      echo ok > "$TMP/a-$i"; else echo no > "$TMP/a-$i"; fi ) &
done
wait
ok_a=$(grep -l ok "$TMP"/a-* | wc -l | tr -d ' ')
del_asistente=$(psql_q -c "select (funcion_ocupacion('$F_DOS')->>'ocupadas')::int")
echo "A. cupo del asistente 5 (capacidad 7), $N apartados del asistente a la vez: $ok_a pasaron, ocupadas $del_asistente"
if [ "$del_asistente" -gt 5 ]; then echo "   SOBREVENTA del asistente" >&2; falla=1; fi
if [ "$ok_a" -ne 5 ] || [ "$del_asistente" -ne 5 ]; then echo "   se esperaban exactamente 5" >&2; falla=1; fi
# El equipo agrega hasta la capacidad: 2 más, y la tercera no.
equipo_ok=0
for i in 1 2 3; do if apartar_equipo "$F_DOS" "eq-a-$i"; then equipo_ok=$((equipo_ok + 1)); fi; done
total_a=$(psql_q -c "select (funcion_ocupacion('$F_DOS')->>'ocupadas')::int")
echo "   el equipo agrega 3 de a 1: pasaron $equipo_ok, ocupadas $total_a de 7"
if [ "$equipo_ok" -ne 2 ] || [ "$total_a" -ne 7 ]; then echo "   se esperaban 2 del equipo y 7 en total" >&2; falla=1; fi

# ── B. Idempotencia: la misma clave 10 veces a la vez = una reserva ─────────────────────────────────────────
for i in $(seq 1 10); do
  ( en_transaccion equipo "select funcion_apartar('$WS', '$F_CLAVE', 1, 'total', '{}'::jsonb, 'misma-clave', 'equipo')" || true ) &
done
wait
misma=$(psql_q -c "select count(*) from funcion_reservas where clave_idempotencia = 'misma-clave'")
echo "B. misma clave 10 veces a la vez: $misma reserva(s)"
if [ "$misma" -ne 1 ]; then falla=1; fi

# ── C. Confirmar a la vez apartados vencidos: solo los que caben ─────────────────────────────────────────────
# Capacidad 4: 4 apartados de 1 que vencen, 4 nuevos que llenan el cupo y 2 de ellos se cancelan. Quedan 2 libres, y
# los 4 vencidos se confirman a la vez (el pago llegó tarde): pueden entrar 2, nunca más.
for i in 1 2 3 4; do apartar_equipo "$F_CONF" "viejo-$i"; done
psql_q -c "update funcion_reservas set vence_at = now() - interval '1 minute' where clave_idempotencia like 'viejo-%'" >/dev/null
for i in 1 2 3 4; do apartar_equipo "$F_CONF" "nuevo-$i"; done
psql_q -c "update funcion_reservas set estado = 'cancelada' where clave_idempotencia in ('nuevo-1', 'nuevo-2')" >/dev/null
mapfile -t viejos < <(psql_q -c "select id from funcion_reservas where clave_idempotencia like 'viejo-%' order by id")
for r in "${viejos[@]}"; do
  ( en_transaccion equipo "select funcion_confirmar_pago('$r', 'verificado_manual')" || true ) &
done
wait
confirmadas=$(psql_q -c "select count(*) from funcion_reservas where clave_idempotencia like 'viejo-%' and estado = 'confirmada'")
ocupadas_c=$(psql_q -c "select (funcion_ocupacion('$F_CONF')->>'ocupadas')::int")
echo "C. ${#viejos[@]} apartados vencidos confirmados a la vez con 2 libres: $confirmadas confirmadas, ocupadas $ocupadas_c de 4"
if [ "$ocupadas_c" -gt 4 ]; then echo "   SOBREVENTA al confirmar" >&2; falla=1; fi
if [ "$confirmadas" -ne 2 ]; then echo "   se esperaban exactamente 2" >&2; falla=1; fi

# ── D. Dos pagos a la vez sobre la misma función: no se pasa de la capacidad ───────────────────────────────
# Dos clientes (conversaciones 101 y 102) apartan 1 en F_PAGO (capacidad 3) y 1 en otra función, y cada uno prepara UN
# pago por sus dos reservas. Sus apartados de F_PAGO vencen y el equipo toma 2 puestos: queda 1 libre. Los dos avisos
# de pago llegan a la vez: solo uno puede confirmar su reserva de F_PAGO; la otra queda `pendiente_persona`.
servidor_sql() {
  psql_q <<SQL
select set_config('prueba.uid', '', false);
set role service_role;
$1;
SQL
}
for c in 101 102; do
  servidor_sql "select funcion_apartar('$WS', '$F_PAGO', 1, 'total', '{\"canal\": \"instagram\", \"chatwoot_cuenta_id\": 1, \"chatwoot_conversacion_id\": $c}'::jsonb, 'p$c-a', 'asistente')" >/dev/null
  servidor_sql "select funcion_apartar('$WS', '$F_OTRA', 1, 'total', '{\"canal\": \"instagram\", \"chatwoot_cuenta_id\": 1, \"chatwoot_conversacion_id\": $c}'::jsonb, 'p$c-b', 'asistente')" >/dev/null
  ids=$(psql_q -c "select string_agg(id::text, ',' order by id) from funcion_reservas where clave_idempotencia in ('p$c-a', 'p$c-b')")
  pago=$(servidor_sql "select funcion_preparar_pago('$WS', '{$ids}'::uuid[])->>'pago_id'" | tail -1)
  servidor_sql "select funcion_vincular_link('$pago', 'REF-$c', null)" >/dev/null
done
psql_q -c "update funcion_reservas set vence_at = now() - interval '1 minute' where clave_idempotencia in ('p101-a', 'p102-a')" >/dev/null
apartar_equipo "$F_PAGO" "eq-d-1"
apartar_equipo "$F_PAGO" "eq-d-2"
for c in 101 102; do
  monto=$(psql_q -c "select monto_esperado from funcion_pagos where referencia = 'REF-$c'")
  ( en_transaccion asistente "select funcion_registrar_pago('$WS', 'REF-$c', 'aprobado', $monto)" || true ) &
done
wait
confirmadas_d=$(psql_q -c "select count(*) from funcion_reservas where clave_idempotencia in ('p101-a', 'p102-a') and estado = 'confirmada'")
pendientes_d=$(psql_q -c "select count(*) from funcion_reservas where clave_idempotencia in ('p101-a', 'p102-a') and estado = 'pendiente_persona'")
ocupadas_d=$(psql_q -c "select (funcion_ocupacion('$F_PAGO')->>'ocupadas')::int")
echo "D. dos pagos a la vez con 1 libre en la misma función: $confirmadas_d confirmada(s), $pendientes_d pendiente(s) de persona, ocupadas $ocupadas_d de 3"
if [ "$ocupadas_d" -gt 3 ]; then echo "   SOBREVENTA con dos pagos" >&2; falla=1; fi
if [ "$confirmadas_d" -ne 1 ] || [ "$pendientes_d" -ne 1 ]; then echo "   se esperaban 1 confirmada y 1 pendiente de persona" >&2; falla=1; fi

if [ "$falla" -ne 0 ]; then echo "FALLÓ" >&2; exit 1; fi
echo "Sin sobreventa."
