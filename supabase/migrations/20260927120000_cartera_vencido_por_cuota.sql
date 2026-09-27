-- ============================================================
-- 20260927120000_cartera_vencido_por_cuota
-- ============================================================
-- Lo vencido de un negocio con cronograma de cuotas es lo que ya debio pagarse,
-- no todo lo que falta del contrato.
--
-- Detonante (Mauricio, 2026-09-27): la alerta diaria `metrik_alerta_saldo_vencido`
-- del workspace MeTRIK anunciaba a ALMA (A1 26 1) con "saldo vencido de
-- $3.600.000 con 159 dias". ALMA es un contrato de 12 cuotas de $400.000: pago
-- las tres primeras y le falta solo la 4 (esperada el 2026-09-15). Lo vencido
-- era $400.000 con 12 dias de mora; los $3.200.000 restantes son cuotas de
-- octubre a mayo que todavia no vencen.
--
-- Causa: la vista daba un solo numero, `saldo = honorario - recaudado`, y un solo
-- reloj, `dias = hoy - creacion del negocio`. Las tres superficies que hablan de
-- "vencido" (W25 y W29 en wa-alerts, "¿quien me debe?" en wa-webhook, y la
-- cartera vencida del semaforo de /numeros) marcaban vencido TODO el saldo en
-- cuanto el negocio cumplia 30 dias de creado. Para un plan de cuotas eso es
-- falso desde el dia 31.
--
-- Que cambia. Cuatro columnas nuevas AL FINAL (las existentes no se tocan, y
-- los consumidores que no las piden siguen igual):
--
--   con_cronograma  el negocio tiene cuotas programadas: al menos un cobro
--                   `tipo_cobro = 'programado'` sin anular. No se exige
--                   `planes_cobro.activo`: en MeTRIK hay cuotas programadas sin
--                   plan (W1 26 1) y planes inactivos con cuotas vivas.
--   saldo_vencido   con cronograma: suma de las cuotas programadas con
--                   `fecha_esperada <= hoy` (Bogota), sin pagar (`fecha IS NULL`)
--                   y sin anular, topada en `saldo`. Sin cronograma: NULL — ahi
--                   la regla de los 30 dias sigue viviendo en la app
--                   (`DIAS_CARTERA_VENCIDA`), como hasta hoy.
--   saldo_por_vencer  con cronograma: `saldo - saldo_vencido`. Sin cronograma: NULL.
--   dias_mora       con cronograma: dias desde la cuota vencida sin pagar MAS
--                   ANTIGUA; NULL si ninguna esta vencida. Sin cronograma: NULL.
--
-- No se usa `cobros.vencido`: es una marca pegajosa que pone el cron con 3 dias
-- de gracia y que no se apaga al pagar (A1 26 3 tiene cuotas pagadas con
-- `vencido = true`). Lo que manda es `fecha IS NULL`.
--
-- De paso, `dias` se cuenta en dias de Bogota (`hoy_bogota()`, migracion
-- 20260927000001, que dejo esta vista anotada como pendiente). Mismo tipo y
-- mismo nombre; puede moverse un dia entre las 19:00 y la medianoche.
--
-- ⚠️ CREATE OR REPLACE VIEW borra `security_invoker`: se repone explicito abajo.
-- ⚠️ La vista esta concedida a `authenticated` (/numeros y /tableros la leen con
--    el cliente de la sesion; la RLS de las tablas es el control). Se repite el
--    grant y el revoke a anon para que la decision quede escrita en el ledger.
-- ⚠️ ORDEN: esta migracion va ANTES del merge y del deploy de wa-alerts y
--    wa-webhook. Los consumidores nuevos piden las columnas nuevas; sin ellas
--    PostgREST responde 42703 y el `?? []` lo convierte en "cartera $0".
-- ============================================================

create or replace view public.v_cartera_negocio as
with recaudo as (
  select cv.negocio_id, sum(cv.a_tramo1 + cv.a_tramo2) as honorario_recaudado
  from public.v_cobro_valor cv
  group by cv.negocio_id
),
cuotas as (
  select
    c.negocio_id,
    sum(c.monto) filter (
      where c.fecha is null and c.fecha_esperada <= public.hoy_bogota()
    ) as vencido_cuotas,
    min(c.fecha_esperada) filter (
      where c.fecha is null and c.fecha_esperada <= public.hoy_bogota()
    ) as vencida_mas_antigua
  from public.cobros c
  where c.tipo_cobro = 'programado'
    and c.anulado_at is null
    and c.negocio_id is not null
  group by c.negocio_id
),
base as (
  select
    n.workspace_id,
    n.id as negocio_id,
    n.codigo,
    n.nombre,
    n.precio_aprobado as honorario,
    r.honorario_recaudado,
    greatest(0, n.precio_aprobado - r.honorario_recaudado) as saldo,
    (public.hoy_bogota() - (n.created_at at time zone 'America/Bogota')::date) as dias,
    (q.negocio_id is not null) as con_cronograma,
    q.vencido_cuotas,
    q.vencida_mas_antigua
  from public.negocios n
  join recaudo r on r.negocio_id = n.id
  left join cuotas q on q.negocio_id = n.id
  where n.precio_aprobado is not null
    and n.estado not in ('perdido', 'cancelado')
)
select
  b.workspace_id,
  b.negocio_id,
  b.codigo,
  b.nombre,
  b.honorario,
  b.honorario_recaudado,
  b.saldo,
  b.dias,
  b.con_cronograma,
  case when b.con_cronograma
    then least(b.saldo, coalesce(b.vencido_cuotas, 0))
  end as saldo_vencido,
  case when b.con_cronograma
    then b.saldo - least(b.saldo, coalesce(b.vencido_cuotas, 0))
  end as saldo_por_vencer,
  case when b.con_cronograma and b.vencida_mas_antigua is not null
    then public.hoy_bogota() - b.vencida_mas_antigua
  end as dias_mora
from base b;

alter view public.v_cartera_negocio set (security_invoker = on);

revoke all on public.v_cartera_negocio from anon;
grant select on public.v_cartera_negocio to authenticated, service_role;

comment on view public.v_cartera_negocio is
  'Cartera de honorarios por negocio vendido (con al menos un pago). saldo = honorario - recaudado. Con cronograma de cuotas (con_cronograma), lo vencido es saldo_vencido (cuotas esperadas hasta hoy sin pagar) y dias_mora cuenta desde la mas antigua; el resto es saldo_por_vencer, que NO es vencido. Sin cronograma esas tres son NULL y la app aplica sus 30 dias sobre `dias`. Migracion 20260927120000.';
