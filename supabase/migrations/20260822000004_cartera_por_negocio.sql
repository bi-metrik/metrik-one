-- Cartera por negocio: lo que falta por recaudar del HONORARIO.
--
-- Por que no sale de `facturas`. Esa tabla tiene 0 filas en los 15 workspaces
-- (medido 2026-08-22), y `cobros.factura_id` es NULL en las 203 filas que
-- existen. /numeros calculaba la cartera como `facturas - cobros`, asi que
-- devolvia el recaudo historico en negativo: -$88.973.023 en SOENA, contra
-- $79.936.645 de cartera real. `v_cartera_antiguedad` arrastra el mismo origen
-- y por eso devuelve cero filas para todos.
--
-- La vara es la misma de /conciliacion: **solo el honorario es cartera**. La
-- tarifa UPME es plata de terceros que el negocio recauda y gira, y se imputa
-- DESPUES del honorario (`lib/upme/imputacion-pago.ts`, PR #314). Por eso la
-- suma es `a_tramo1 + a_tramo2` y no `monto`: `a_tarifa` no es deuda con nadie.
--
-- Se devuelven TODOS los negocios vivos con precio aprobado, incluidos los de
-- saldo cero. Quien consuma filtra por el umbral que le sirva; el universo
-- completo es el que da el denominador de la tasa de cobro.
create or replace view v_cartera_negocio as
with recaudo as (
  select cv.negocio_id, sum(cv.a_tramo1 + cv.a_tramo2) as honorario_recaudado
  from v_cobro_valor cv
  group by cv.negocio_id
)
select
  n.workspace_id,
  n.id as negocio_id,
  n.codigo,
  n.nombre,
  n.precio_aprobado as honorario,
  coalesce(r.honorario_recaudado, 0) as honorario_recaudado,
  greatest(0, n.precio_aprobado - coalesce(r.honorario_recaudado, 0)) as saldo,
  (current_date - n.created_at::date) as dias
from negocios n
left join recaudo r on r.negocio_id = n.id
where n.precio_aprobado is not null
  and n.estado not in ('perdido', 'cancelado');

-- `security_invoker` para que la RLS de `negocios` y `cobros` siga mandando:
-- sin esto la vista leeria con los permisos del dueno y cruzaria workspaces.
-- Mismo patron que `v_pyl_mes` y `v_cobro_valor`.
alter view v_cartera_negocio set (security_invoker = on);
grant select on v_cartera_negocio to authenticated;

-- `v_venta_mes_comercial` ya existe y ya define que es una venta (el mes del
-- primer cobro imputado). /numeros necesita esa misma definicion para P4, que
-- hoy lee `facturas` y por eso da $0 siempre. Se le abre el select en vez de
-- escribir una segunda definicion de "venta" que se desincronice de la primera.
-- La vista tambien es `security_invoker`, asi que el grant no cruza workspaces.
grant select on v_venta_mes_comercial to authenticated;
