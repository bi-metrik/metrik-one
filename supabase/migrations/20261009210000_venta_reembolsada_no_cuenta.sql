-- ============================================================
-- 20261009210000_venta_reembolsada_no_cuenta
-- ============================================================
-- SOE-007, segunda parte. Decisión de Mauricio (2026-10-09), textual:
--
--   «V0494 no puede contar en los indicadores comerciales pq al final no generó un ingreso
--   para la empresa. Pero es importante que se vea en los indicadores cuantos reembolsos
--   llevamos.»
--
-- ── 1. Una venta devuelta en su totalidad deja de ser venta ──
--
-- Regla: un negocio cuyas devoluciones cubren TODO lo que pagó (recaudo neto ≤ 0) sale de
-- `v_venta_mes_comercial`. Lo cobrado se mide con el MISMO criterio que
-- `registrar_devolucion_dinero` usa para no devolver de más: cobros con fecha (un
-- `programado` sin fecha es una cuota por pagar) y sin `devolucion_pendiente`. Como esa
-- función no deja devolver más que el neto, «devuelto ≥ cobrado» es exactamente «se devolvió
-- todo».
--
-- Al salir de la vista sale de TODO lo que cuenta ventas, porque todo lee de ahí: ventas del
-- mes, valor vendido, ticket promedio, bonificables, honorario cubierto, «Negocios cerrados»
-- de Dirección, por vendedor, por origen, por seccional, por plan de pago, la página Equipo
-- (resumen y perfil) y la cohorte de segundo pago. Sale del MES DE SU VENTA: eso cambia un
-- mes cerrado, y Mauricio lo decidió así. Una devolución PARCIAL no saca la venta.
--
-- Lo que NO cambia:
--   * El recaudo por mes (caja). La devolución ya resta en el mes en que salió el dinero
--     (`v_recaudo_neto_valor`, 20261009160000). Dirección «Ingresos primer pago» y la serie de
--     recaudo son caja: septiembre conserva lo que entró en septiembre y octubre resta lo
--     devuelto. Quitar además la venta no cuenta dos veces: una cosa es la venta (cohorte) y
--     otra el dinero del mes.
--   * La tasa de cancelación. `get_comercial_kpis_mes_soena` cuenta los perdidos por estado,
--     no por ventas, así que V0494 sigue contando como perdido. Lo que deja de pasar es que
--     el mismo caso sume a la vez como venta de septiembre y como perdido de octubre.
--   * `v_cobro_valor`, gates, conciliación, Siigo y cartera.
--
-- ── 2. Indicador de reembolsos ──
--
-- `get_reembolsos_mes_soena`: cuántas devoluciones y cuánto dinero, sin IVA, salió en el mes,
-- por FECHA DE LA DEVOLUCIÓN, con la lista (caso, nombre, fecha, valor, motivo, si cerró el
-- caso, comercial). La leen Dirección y Comercial; el corte por vendedor se suma en pantalla de
-- la misma lista.
--
-- ── Por qué la vista se reescribe sobre `pg_get_viewdef` ──
--
-- Las vistas y RPC de SOENA han divergido del repo antes. Se hace UN reemplazo de texto sobre la
-- definición viva (el WHERE final, patrón de 20261009160000) y ABORTA si el patrón no aparece
-- exactamente una vez. Medido el 2026-10-09 contra producción: la vista viva es la de
-- `20260903120000`, sin `security_invoker` (reloptions null). Idempotente: si ya lee
-- `v_negocio_reembolso`, se salta.
--
-- Las RPC de ventas NO se tocan: leen la vista, y con la vista basta.
-- ============================================================

-- ── 1a. Lo cobrado y lo devuelto por negocio ──────────────────────────────────
--
-- Solo los negocios con alguna devolución. `reembolso_total` es la regla de la sección 1.

create or replace view public.v_negocio_reembolso with (security_invoker = on) as
select d.workspace_id,
       d.negocio_id,
       count(*)                                              as devoluciones,
       sum(d.monto)                                          as devuelto,
       min(d.fecha)                                          as primera_devolucion,
       max(d.fecha)                                          as ultima_devolucion,
       coalesce(c.cobrado, 0::numeric)                       as cobrado,
       sum(d.monto) >= coalesce(c.cobrado, 0::numeric)       as reembolso_total
from devoluciones_dinero d
left join lateral (
  select sum(cb.monto) as cobrado
  from cobros cb
  where cb.negocio_id = d.negocio_id
    and cb.fecha is not null
    and coalesce(cb.tipo_cobro, ''::text) <> 'devolucion_pendiente'::text
) c on true
group by d.workspace_id, d.negocio_id, c.cobrado;

comment on view public.v_negocio_reembolso is
  'SOE-007. Por negocio con devoluciones: cuánto se cobró (mismo criterio que '
  'registrar_devolucion_dinero), cuánto se devolvió y si se devolvió todo. Un negocio con '
  'reembolso_total sale de v_venta_mes_comercial.';

-- La lee v_venta_mes_comercial (corre como su dueño) y las RPC de tablero (SECURITY DEFINER).
-- No se concede a `authenticated`.
revoke all on public.v_negocio_reembolso from anon, authenticated;

-- ── 1b. v_venta_mes_comercial deja fuera la venta reembolsada en su totalidad ──
--
-- vista-definer: v_venta_mes_comercial corre como su dueño desde 20260812230000 (revocada a
-- anon y authenticated; la leen el servidor con service_role y las RPC de tablero). Declararla
-- invoker la dejaría vacía para el rol de servicio. El reemplazo de abajo NO le cambia la
-- opción: se comprueba que hoy no tiene ninguna (si la tuviera, aborta en vez de borrarla).

do $$
declare
  v_viejo  constant text := 'WHERE cn.negocio_id IS NOT NULL OR vz.negocio_id IS NOT NULL;';
  v_nuevo  constant text := 'WHERE (cn.negocio_id IS NOT NULL OR vz.negocio_id IS NOT NULL) AND NOT (EXISTS ( SELECT 1 FROM v_negocio_reembolso rt WHERE rt.negocio_id = n.id AND rt.reembolso_total));';
  v_def    text;
  v_opts   text[];
  v_n      int;
begin
  select pg_get_viewdef(c.oid, true), c.reloptions
    into v_def, v_opts
    from pg_class c
   where c.oid = 'public.v_venta_mes_comercial'::regclass;

  if position('v_negocio_reembolso' in v_def) > 0 then
    raise notice 'v_venta_mes_comercial ya excluye las ventas reembolsadas: se salta';
    return;
  end if;

  if v_opts is not null then
    raise exception 'v_venta_mes_comercial tiene reloptions % en producción: CREATE OR REPLACE las borraría. Revisar a mano.', v_opts;
  end if;

  v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  if v_n <> 1 then
    raise exception 'v_venta_mes_comercial cambió en producción: "%" aparece % veces (se esperaba 1). Revisar a mano antes de aplicar.',
      v_viejo, v_n;
  end if;

  execute 'create or replace view public.v_venta_mes_comercial as ' || replace(v_def, v_viejo, v_nuevo);
end;
$$;

comment on view public.v_venta_mes_comercial is
  'Una fila por negocio vendido. TODAS las cifras de honorario van NETAS de IVA '
  '(honorario_sin_iva, honorario_recaudado, primer_pago, segundo_pago) porque es lo '
  'que miden los tableros: ingreso, no caja. `tarifa` va integra porque la tarifa UPME '
  'no causa IVA. `honorario_con_iva` se conserva como cifra de CARTERA (lo que el '
  'cliente paga), no como cifra de ingreso. '
  'Un negocio entra por una de dos puertas: tiene cobros, o es una VENTA EN CERO '
  '(convenio ejecutado sin cobro). La segunda exige `precio_aprobado = 0` ESCRITO '
  '(nunca NULL, que significa dato faltante), cero cobros y `bonificable` verdadero en '
  'v_negocio_bonificable, que prueba por evidencia el paso del umbral declarado por la '
  'linea; su `fecha_venta` es la primera entrada a esa etapa umbral. Las ventas en cero '
  'salen con `bonificable = false` por decision de Mauricio: cuentan como cierre y no '
  'pagan bono ni comision. Ojo: eso BAJA `tasa_bonificables`, porque suman al '
  'denominador y nunca al numerador. '
  'SOE-007 (2026-10-09): un negocio al que se le devolvio TODO lo que pago '
  '(v_negocio_reembolso.reembolso_total) no es venta y sale de la vista, tambien del mes '
  'en que se vendio. Una devolucion parcial no la saca.';

-- `create or replace view` conserva la ACL; el revoke se repone igual para dejar la decisión
-- escrita en el archivo que toca la vista.
revoke all on public.v_venta_mes_comercial from anon, authenticated;

-- ── 2. Indicador de reembolsos ────────────────────────────────────────────────
--
-- Una fila por devolución con fecha en el mes. `valor` es lo devuelto sin el IVA: el honorario
-- devuelto en base (tramo 1 + tramo 2, `_base`) más la tarifa UPME y el excedente, que no causan
-- IVA. Es la misma vara que el resto del tablero. `monto` es lo que salió de la cuenta.
--
-- `cierre`: 'cerro_caso' si esta devolución cerró el negocio; 'ya_cerrado' si el negocio ya
-- estaba perdido o cancelado; 'abierto' si el caso sigue. `venta_anulada`: el negocio quedó
-- con todo devuelto y ya no cuenta como venta.

create or replace function public.get_reembolsos_mes_soena(p_workspace_id uuid, p_anio integer, p_mes integer)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with guard as (
    select p_workspace_id as id
    where p_workspace_id = current_user_workspace_id()
  ),
  rango as (
    select make_date(p_anio, p_mes, 1) as desde,
           (make_date(p_anio, p_mes, 1) + interval '1 month')::date as hasta,
           (make_date(p_anio, p_mes, 1) - interval '1 month')::date as desde_anterior
  ),
  devs as (
    select dv.devolucion_id, dv.negocio_id, dv.fecha, dv.monto,
           dv.a_tramo1_base + dv.a_tramo2_base + dv.a_tarifa + dv.excedente as valor,
           dv.a_tramo1_base + dv.a_tramo2_base                               as honorario
    from v_devolucion_valor dv
    join guard g on dv.workspace_id = g.id
  ),
  det as (
    select dv.devolucion_id, dv.negocio_id, n.codigo, n.nombre, dv.fecha, dv.monto, dv.valor,
           dv.honorario, d.motivo, n.estado,
           case when d.cerro_caso then 'cerro_caso'
                when n.estado in ('perdido', 'cancelado') then 'ya_cerrado'
                else 'abierto' end                                 as cierre,
           coalesce(nr.reembolso_total, false)                       as venta_anulada,
           vc.comercial_staff_id                                     as responsable_id,
           s.full_name                                               as responsable,
           d.created_at
    from devs dv
    cross join rango r
    join devoluciones_dinero d on d.id = dv.devolucion_id
    join negocios n on n.id = dv.negocio_id
    left join v_negocio_reembolso nr on nr.negocio_id = dv.negocio_id
    left join v_negocio_comercial vc on vc.negocio_id = dv.negocio_id
    left join staff s on s.id = vc.comercial_staff_id
    where dv.fecha >= r.desde and dv.fecha < r.hasta
  )
  select jsonb_build_object(
    'anio', p_anio,
    'mes', p_mes,
    'reembolsos', (select count(*) from det),
    'negocios',   (select count(distinct negocio_id) from det),
    'valor',      coalesce((select sum(valor) from det), 0),
    'monto',      coalesce((select sum(monto) from det), 0),
    'ventas_anuladas', (select count(distinct negocio_id) from det where venta_anulada),
    'detalle', coalesce((
      select jsonb_agg(jsonb_build_object(
        'devolucion_id',  d.devolucion_id,
        'negocio_id',     d.negocio_id,
        'codigo',         d.codigo,
        'nombre',         d.nombre,
        'fecha',          to_char(d.fecha, 'YYYY-MM-DD'),
        'valor',          d.valor,
        'honorario',      d.honorario,
        'monto',          d.monto,
        'motivo',         d.motivo,
        'cierre',         d.cierre,
        'venta_anulada',  d.venta_anulada,
        'responsable_id', d.responsable_id,
        'responsable',    d.responsable
      ) order by d.fecha desc, d.created_at desc, d.codigo)
      from det d), '[]'::jsonb),
    -- Los totales del mes anterior, con el mismo criterio, para la comparación del panel.
    'anterior', jsonb_build_object(
      'reembolsos', (select count(*) from devs dv, rango r
                      where dv.fecha >= r.desde_anterior and dv.fecha < r.desde),
      'valor', coalesce((select sum(dv.valor) from devs dv, rango r
                          where dv.fecha >= r.desde_anterior and dv.fecha < r.desde), 0)
    )
  )
  where exists (select 1 from guard);
$function$;

comment on function public.get_reembolsos_mes_soena(uuid, integer, integer) is
  'SOE-007. Devoluciones de dinero con fecha en el mes: cuántas, cuánto sin IVA (`valor`) y '
  'cuánto salió de caja (`monto`), con la lista (caso, fecha, valor, motivo, cierre, '
  'comercial). Por fecha de la devolución, no de la venta.';

-- ejecutable-por-cliente: la llaman las server actions de Tableros con la sesion del
-- usuario; la propia funcion filtra por current_user_workspace_id() (guard).
revoke execute on function public.get_reembolsos_mes_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_reembolsos_mes_soena(uuid, integer, integer) to authenticated;
