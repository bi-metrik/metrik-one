-- El guard de cobro deja de frenar un honorario en cero que fue DECIDIDO.
--
-- ⚠️ DEFECTO DEL GUARD ORIGINAL (mergeado hoy en #278, y nunca encendido)
--
-- `negocio_exige_honorario_confirmado` miraba solo `precio_aprobado <= 0`. Pero
-- un honorario en cero tiene DOS causas que desde esa columna se ven idénticas:
--   (a) nadie cotizó todavía  → falta el dato, y frenar el cobro es lo correcto;
--   (b) alguien aprobó una propuesta REGALANDO el servicio → es una decisión
--       comercial ya tomada, y frenarla no le deja salida al equipo salvo
--       cambiar un precio que otra persona decidió.
--
-- Medido en produccion el 2026-08-13: V0066 tiene su propuesta aprobada, con
-- Plan 1 en $850.000 y Plan 2 con 100% de descuento; se aprobó el Plan 2, su PDF
-- quedó en Drive y `aprobado_honorario` es 0. El guard lo habría frenado por (b).
--
-- El producto YA distinguía los dos casos: `esCeroDeliberado`
-- (`src/lib/upme/modelo-dinero.ts`), que consumen el gate de handoff y el
-- reparto. El guard nuevo no lo usaba, o sea que había DOS criterios sobre el
-- mismo hecho — exactamente lo que este repo ya pagó caro con la fórmula de
-- saldo. Esta migración los alinea.
--
-- CRITERIO (espejo literal de `esCeroDeliberado`):
--   existe una propuesta APROBADA (`aprobado_at` no nulo) cuyo honorario
--   conocido es <= 0. El honorario sale de `aprobado_honorario` y, cuando ese
--   campo no trae un número, de `precio_aprobado`. Una versión generada y NO
--   aprobada no cuenta: generar no es decidir.
--
-- ⚠️ ORDEN DE APLICACION: la migracion de #278 (`20260812234000`) esta mergeada
-- pero NO aplicada en produccion — medido el 2026-08-13: la funcion, la RPC y el
-- trigger sobre `cobros` no existen. Aplicar primero aquella y despues esta.
-- Esta usa `create or replace`, asi que el orden inverso deja la funcion buena
-- pero sin el trigger que la invoca, o sea sin guard.
--
-- ALCANCE: el guard sigue APAGADO (`config_extra.cobro` sin declarar en ninguna
-- linea ni workspace), asi que esto no cambia el comportamiento de nadie hoy.
--
-- ENSAYADO contra produccion en transaccion con rollback (2026-08-13), con la
-- config de la linea GIT EV/HEV encendida dentro de la transaccion: de los 65
-- negocios abiertos de SOENA sin precio, **V0066 es el unico con propuesta
-- aprobada** y el unico que este cambio libera. Los otros 64 siguen frenados,
-- que es lo correcto: a esos si les falta el dato. Entre ellos los 4 casos de
-- Cita del cargue historico (V0231, V0246, V0247, V0248), cuyo honorario esta
-- pendiente de recuperar de la fuente historica del proceso.

create or replace function public.negocio_exige_honorario_confirmado(p_negocio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- la linea gana sobre el workspace; la primera que declare, manda
    (l.config_extra #>> '{cobro,exige_honorario_confirmado}')::boolean,
    (w.config_extra #>> '{cobro,exige_honorario_confirmado}')::boolean,
    false
  )
  and coalesce(n.precio_aprobado, 0) <= 0
  and n.estado = 'abierto'
  -- Un cero DECIDIDO no es un cero que falta.
  and not exists (
    select 1
    from negocio_bloques nb
    join bloque_configs bc on bc.id = nb.bloque_config_id
    join bloque_definitions bd on bd.id = bc.bloque_definition_id
    where nb.negocio_id = n.id
      and bd.tipo = 'propuesta_economica'
      and nb.data ->> 'aprobado_at' is not null
      and coalesce(
            -- `aprobado_honorario` puede venir como texto no numérico o ausente;
            -- el regex evita que un valor sucio reviente la función, y el
            -- respaldo es el mismo que usa el helper en TS.
            case when (nb.data ->> 'aprobado_honorario') ~ '^-?[0-9]+(\.[0-9]+)?$'
                 then (nb.data ->> 'aprobado_honorario')::numeric end,
            n.precio_aprobado
          ) <= 0
  )
  from negocios n
  join workspaces w on w.id = n.workspace_id
  left join lineas_negocio l on l.id = n.linea_id
  where n.id = p_negocio_id;
$$;

comment on function public.negocio_exige_honorario_confirmado(uuid) is
  'true si al negocio le FALTA el honorario confirmado y su linea/workspace lo exige para cobrar. Un cero aprobado a proposito (servicio regalado) NO cuenta como faltante: espejo de esCeroDeliberado. Fuente unica del criterio: la consumen el trigger de cobros y la RPC de aviso previo.';

-- server-only: la invoca el trigger sobre `cobros`. El cliente usa `negocio_puede_recibir_cobro`.
revoke execute on function public.negocio_exige_honorario_confirmado(uuid) from public, anon, authenticated;
