-- ============================================================
-- 20261016100200 — MRR por producto: negocios con contrato recurrente + suscripciones
--
-- Para que Carmen defina cómo se reporta. Esta vista NO decide la regla contable: junta las dos bases
-- (contratos de negocios del CRM y suscripciones_producto) con supuestos ESCRITOS, uno por columna, para
-- que se puedan discutir y cambiar sin adivinar qué hizo el SQL.
--
-- ## Supuestos (cada uno visible en la salida)
--
--   S1  La unidad es el PLAN DE COBRO (`planes_cobro`) del contrato, no el contrato: el plan es lo que
--       dice cuánto y cada cuánto se cobra. El MRR de un plan es `monto` llevado a mes según `frecuencia`
--       (mensual 1, bimestral 1/2, trimestral 1/3, semestral 1/6, anual 1/12). Una frecuencia que no se
--       conoce queda con `mrr_cop` NULL y `supuesto_frecuencia = 'desconocida'`: no se adivina.
--   S2  `monto` se toma tal cual está en el plan (lo que se factura por cuota). Si incluye IVA o no, es
--       del plan: la vista no lo separa (columna `iva_separado = false`).
--   S3  Cuenta lo VIGENTE HOY (Bogotá): el plan arrancó (`fecha_inicio <= hoy`) y no terminó
--       (`fecha_fin >= hoy`, o se renueva solo). No mira si la cuota está pagada: la mora NO resta MRR.
--   S4  `activo` del plan NO se usa: los planes enrolados por ciclo nacen con `activo = false` a propósito
--       (es el interruptor del emisor de cuentas de cobro, no del contrato).
--   S5  Un plan de un negocio cuenta solo si su contrato (`servicios_contratados`) está activo o pausado.
--       `clase` dice de dónde sale: 'contrato_ciclo' (ficha que se cobra por ciclo: suscripción en
--       negocios), 'contrato_consumo' (bolsas prepagadas, p. ej. Valida API: NO es MRR por defecto) y
--       'plan_sin_contrato' (planes cargados a mano sobre un negocio, sin contrato: honorarios en cuotas
--       o licencias viejas; la vista no sabe cuál es cuál y NO los suma por defecto).
--   S6  Una suscripción cuenta si su estado es 'activa' (una 'prueba' no paga; 'suspendida' y 'cancelada'
--       no cuentan).
--   S7  El producto: el de la suscripción; para un negocio, por el módulo de la ficha del contrato
--       (valida_consulta y valida_api → 'valida', business → 'business', compliance → 'sustenta').
--   S8  `v_mrr_por_producto_resumen` suma SOLO `cuenta_en_mrr = true` (contrato_ciclo y suscripciones).
--       Las demás filas están en el detalle para que Carmen decida si entran.
--
-- ## Quién la lee
--
-- Va en security_invoker y SIN grant a nadie. Cruza los espacios de todos los
-- clientes del cobrador, así que solo la lee el servidor (service_role) o el SQL de MeTRIK.
--
-- ## Reversa
--   drop view public.v_mrr_por_producto_resumen; drop view public.v_mrr_por_producto;
-- ============================================================

create view public.v_mrr_por_producto with (security_invoker = on) as
with hoy as (
  select (now() at time zone 'America/Bogota')::date as d
),
planes as (
  select
    p.id as plan_cobro_id,
    p.workspace_id,
    p.negocio_id,
    p.suscripcion_id,
    p.monto,
    p.frecuencia,
    p.fecha_inicio,
    p.fecha_fin,
    p.auto_renovar,
    (p.fecha_inicio <= (select d from hoy) and (p.fecha_fin >= (select d from hoy) or p.auto_renovar)) as vigente_hoy
  from public.planes_cobro p
),
contrato as (
  -- El contrato que manda en el ancla del plan: el activo, y entre varios el de vigencia más reciente.
  select distinct on (pl.plan_cobro_id)
    pl.plan_cobro_id,
    sc.id as servicio_contratado_id,
    sc.estado as contrato_estado,
    sc.servicio_slug,
    cs.modulo,
    cs.disparador_cobro
  from planes pl
  join public.servicios_contratados sc
    on sc.workspace_id = pl.workspace_id
   and (sc.negocio_id = pl.negocio_id or sc.suscripcion_id = pl.suscripcion_id)
  join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
  order by pl.plan_cobro_id, (sc.estado = 'activo') desc, sc.vigente_desde desc
)
select
  pl.plan_cobro_id,
  pl.workspace_id as workspace_cobrador_id,
  case when pl.suscripcion_id is not null then 'suscripcion' else 'negocio' end as fuente,
  pl.negocio_id,
  pl.suscripcion_id,
  c.servicio_contratado_id,
  c.servicio_slug,
  coalesce(
    s.producto,
    case c.modulo
      when 'valida_consulta' then 'valida'
      when 'valida_api' then 'valida'
      when 'business' then 'business'
      when 'compliance' then 'sustenta'
      else c.modulo
    end,
    'sin_contrato'
  ) as producto,
  coalesce(s.razon_social, e.razon_social, e.nombre, n.nombre) as cliente,
  case
    when pl.suscripcion_id is not null then 'suscripcion'
    when c.servicio_contratado_id is null then 'plan_sin_contrato'
    when c.disparador_cobro = 'ciclo' then 'contrato_ciclo'
    else 'contrato_' || coalesce(c.disparador_cobro, 'otro')
  end as clase,
  coalesce(s.estado, c.contrato_estado) as estado,
  pl.frecuencia,
  pl.monto as monto_cuota_cop,
  round(pl.monto / case pl.frecuencia
    when 'mensual' then 1 when 'bimestral' then 2 when 'trimestral' then 3
    when 'semestral' then 6 when 'anual' then 12 end, 0) as mrr_cop,
  case when pl.frecuencia in ('mensual', 'bimestral', 'trimestral', 'semestral', 'anual') then 'conocida' else 'desconocida' end as supuesto_frecuencia,
  false as iva_separado,
  pl.fecha_inicio,
  pl.fecha_fin,
  pl.auto_renovar,
  pl.vigente_hoy,
  (
    pl.vigente_hoy
    and (
      (pl.suscripcion_id is not null and s.estado = 'activa' and c.contrato_estado in ('activo', 'pausado'))
      or (pl.suscripcion_id is null and c.disparador_cobro = 'ciclo' and c.contrato_estado in ('activo', 'pausado'))
    )
  ) as cuenta_en_mrr
from planes pl
left join contrato c on c.plan_cobro_id = pl.plan_cobro_id
left join public.suscripciones_producto s on s.id = pl.suscripcion_id
left join public.negocios n on n.id = pl.negocio_id
left join public.empresas e on e.id = n.empresa_id;

comment on view public.v_mrr_por_producto is
  'MRR por plan de cobro, de negocios con contrato y de suscripciones_producto, con los supuestos S1-S8 de 20261016100200 en columnas (clase, supuesto_frecuencia, iva_separado, vigente_hoy, cuenta_en_mrr). No decide la regla contable: la define Carmen.';

create view public.v_mrr_por_producto_resumen with (security_invoker = on) as
select
  producto,
  fuente,
  count(*) as planes,
  sum(mrr_cop) as mrr_cop
from public.v_mrr_por_producto
where cuenta_en_mrr
group by producto, fuente;

comment on view public.v_mrr_por_producto_resumen is
  'MRR vigente hoy por producto y fuente (negocio | suscripcion), solo filas con cuenta_en_mrr. El detalle y los supuestos, en v_mrr_por_producto.';

-- Solo el servidor: ni anon ni authenticated.
revoke all on public.v_mrr_por_producto from public, anon, authenticated;
revoke all on public.v_mrr_por_producto_resumen from public, anon, authenticated;
