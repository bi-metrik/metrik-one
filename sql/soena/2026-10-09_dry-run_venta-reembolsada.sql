-- Dry-run de 20261009210000_venta_reembolsada_no_cuenta.sql (SOE-007, 2ª parte) contra producción.
--
-- UN solo statement: lee los tableros de SOENA con las RPC VIVAS, aplica la migración, los vuelve a
-- leer SIN devoluciones (tiene que dar idéntico), ENSAYA en V0494 primero una devolución PARCIAL
-- (100.000: la venta no sale) y después la devolución TOTAL (637.500, hoy, «cerrar el caso»
-- marcado), vuelve a leer y aborta con RAISE EXCEPTION. Nada queda escrito —ni la vista nueva, ni
-- la función, ni las devoluciones, ni el historial—: el resultado vuelve en el mensaje del error.
-- Requiere 20261009160000_devoluciones_dinero ya aplicada (lo está desde el 2026-10-09).
-- Correrlo por MCP execute_sql y después confirmar:
--   select to_regclass('public.v_negocio_reembolso');                 -- null
--   select count(*) from devoluciones_dinero;                          -- lo mismo que antes
--
-- Lo que tiene que decir:
--   sin_devoluciones_igual = true: aplicada la migración y SIN devoluciones, la vista de ventas (todos
--     los workspaces), Dirección y KPIs del Comercial (septiembre y el mes en curso) y el resumen de
--     Equipo de septiembre devuelven exactamente lo mismo.
--   vista_reescrita = true (v_venta_mes_comercial lee v_negocio_reembolso).
--   parcial.v0494_sigue_en_ventas = true y parcial.ventas_sep_igual = true.
--   ensayo_total.ok = true, ensayo_total.ya_cerrado = true (V0494 ya está perdido).
--   v0494_en_ventas_despues = false.
--   septiembre: Dirección negocios_cerrados −1 y primer_pago IGUAL (es caja: el dinero entró en
--     septiembre; la devolución resta en el mes en curso, ver delta_mes_en_curso). Comercial
--     num_ventas −1, valor_sin_iva −535.714,29, bonificables igual (V0494 no era bonificable),
--     casos_completos −1.
--   tasa_cancelacion_mes: n_perdidos igual (V0494 sigue como perdido).
--   reembolsos_mes: 1 reembolso, valor 535.714,29 sin IVA, monto 637.500, ventas_anuladas 1.
--   reembolsos_septiembre: 0 (cuenta por el mes de la devolución, no de la venta).
--
-- El cuerpo de la migración va pegado TAL CUAL entre $mig$ (generado, no transcrito). Si se edita
-- la migración, regenerar este archivo.

DO $dry$
DECLARE
  ws     uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  v0494  uuid := '1695e4cf-0799-4a46-8558-171f6ed456d1';
  hoy    date := (now() AT TIME ZONE 'America/Bogota')::date;
  anio   int  := extract(year  FROM (now() AT TIME ZONE 'America/Bogota'))::int;
  mes    int  := extract(month FROM (now() AT TIME ZONE 'America/Bogota'))::int;
  uid    uuid;
  ventas_a text; ventas_b text; n_ventas_a int;
  dir_sep_a jsonb; dir_mes_a jsonb; k_sep_a jsonb; k_mes_a jsonb; res_sep_a jsonb;
  dir_sep_b jsonb; dir_mes_b jsonb; k_sep_b jsonb; k_mes_b jsonb; res_sep_b jsonb;
  dir_sep_c jsonb; dir_mes_c jsonb; k_sep_c jsonb; k_mes_c jsonb;
  k_sep_p jsonb;
  venta_a jsonb;
  sigue_parcial boolean; sigue_total boolean;
  reescrita boolean;
  r_parcial jsonb; r_total jsonb;
  re_mes jsonb; re_sep jsonb;
  r jsonb;
BEGIN
  SELECT p.id INTO uid
  FROM profiles p
  WHERE p.workspace_id = ws AND p.role IN ('owner', 'admin')
  ORDER BY p.role DESC
  LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  IF current_user_workspace_id() IS DISTINCT FROM ws THEN
    RAISE EXCEPTION 'DRYRUN la sesion simulada no resuelve SOENA (uid %): el ensayo no prueba nada', uid;
  END IF;

  SELECT md5(string_agg(row_to_json(v)::text, '|' ORDER BY v.negocio_id)), count(*)
    INTO ventas_a, n_ventas_a FROM v_venta_mes_comercial v;
  SELECT to_jsonb(v) - 'workspace_id' - 'contacto_id' - 'responsable_id' INTO venta_a
    FROM v_venta_mes_comercial v WHERE v.negocio_id = v0494;
  dir_sep_a := public.get_directivo_soena(ws, 2026, 9)->'comercial';
  dir_mes_a := public.get_directivo_soena(ws, anio, mes)->'comercial';
  k_sep_a   := public.get_comercial_kpis_mes_soena(ws, 2026, 9)->'kpis';
  k_mes_a   := public.get_comercial_kpis_mes_soena(ws, anio, mes)->'kpis';
  res_sep_a := public.get_comercial_resumen_soena(ws, 2026, 9);

  EXECUTE $mig$
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
$mig$;

  SELECT position('v_negocio_reembolso' in pg_get_viewdef('public.v_venta_mes_comercial'::regclass)) > 0
    INTO reescrita;

  -- Sin devoluciones, nada cambia.
  SELECT md5(string_agg(row_to_json(v)::text, '|' ORDER BY v.negocio_id)) INTO ventas_b FROM v_venta_mes_comercial v;
  dir_sep_b := public.get_directivo_soena(ws, 2026, 9)->'comercial';
  dir_mes_b := public.get_directivo_soena(ws, anio, mes)->'comercial';
  k_sep_b   := public.get_comercial_kpis_mes_soena(ws, 2026, 9)->'kpis';
  k_mes_b   := public.get_comercial_kpis_mes_soena(ws, anio, mes)->'kpis';
  res_sep_b := public.get_comercial_resumen_soena(ws, 2026, 9);

  -- Ensayo 1: devolución PARCIAL. La venta no sale.
  r_parcial := public.registrar_devolucion_dinero(ws, v0494, hoy, 100000, 'Dry-run SOE-007: ensayo de devolucion parcial',
                                                  NULL, false, NULL, NULL, NULL, NULL);
  SELECT EXISTS (SELECT 1 FROM v_venta_mes_comercial v WHERE v.negocio_id = v0494) INTO sigue_parcial;
  k_sep_p := public.get_comercial_kpis_mes_soena(ws, 2026, 9)->'kpis';
  -- Se deshace el ensayo parcial (todo el bloque se revierte igual al final) para que el total
  -- quede como UNA devolución, que es como la registraría financiera.
  DELETE FROM devoluciones_dinero WHERE negocio_id = v0494;
  DELETE FROM activity_log WHERE entidad_id = v0494 AND campo_modificado = 'devolucion_dinero';

  -- Ensayo 2: devolución TOTAL de V0494, con «cerrar el caso» marcado (ya está perdido).
  r_total := public.registrar_devolucion_dinero(ws, v0494, hoy, 637500, 'Dry-run SOE-007: ensayo de la devolucion total',
                                                NULL, true, NULL, NULL, NULL, NULL);
  SELECT EXISTS (SELECT 1 FROM v_venta_mes_comercial v WHERE v.negocio_id = v0494) INTO sigue_total;
  dir_sep_c := public.get_directivo_soena(ws, 2026, 9)->'comercial';
  dir_mes_c := public.get_directivo_soena(ws, anio, mes)->'comercial';
  k_sep_c   := public.get_comercial_kpis_mes_soena(ws, 2026, 9)->'kpis';
  k_mes_c   := public.get_comercial_kpis_mes_soena(ws, anio, mes)->'kpis';
  re_mes    := public.get_reembolsos_mes_soena(ws, anio, mes);
  re_sep    := public.get_reembolsos_mes_soena(ws, 2026, 9);

  r := jsonb_build_object(
    'vista_reescrita', reescrita,
    'sin_devoluciones_igual',
      ventas_b = ventas_a AND dir_sep_b = dir_sep_a AND dir_mes_b = dir_mes_a
      AND k_sep_b = k_sep_a AND k_mes_b = k_mes_a AND res_sep_b = res_sep_a,
    'filas_vista_antes', n_ventas_a,
    'venta_v0494_antes', venta_a,
    'parcial', jsonb_build_object(
      'registro', r_parcial,
      'v0494_sigue_en_ventas', sigue_parcial,
      'ventas_sep_igual', k_sep_p->'num_ventas' = k_sep_a->'num_ventas'
                          AND k_sep_p->'valor_sin_iva' = k_sep_a->'valor_sin_iva'),
    'ensayo_total', r_total,
    'v0494_en_ventas_despues', sigue_total,
    'septiembre', jsonb_build_object(
      'direccion_negocios_cerrados', jsonb_build_array(dir_sep_a->'negocios_cerrados', dir_sep_c->'negocios_cerrados'),
      'direccion_primer_pago',       jsonb_build_array(dir_sep_a->'primer_pago', dir_sep_c->'primer_pago'),
      'comercial_ventas',            jsonb_build_array(k_sep_a->'num_ventas', k_sep_c->'num_ventas'),
      'comercial_valor_sin_iva',     jsonb_build_array(k_sep_a->'valor_sin_iva', k_sep_c->'valor_sin_iva'),
      'comercial_bonificables',      jsonb_build_array(k_sep_a->'bonificables', k_sep_c->'bonificables'),
      'comercial_tasa_bonificables', jsonb_build_array(k_sep_a->'tasa_bonificables', k_sep_c->'tasa_bonificables'),
      'comercial_ticket_promedio',   jsonb_build_array(k_sep_a->'ticket_promedio', k_sep_c->'ticket_promedio'),
      'comercial_casos_completos',   jsonb_build_array(k_sep_a->'casos_completos', k_sep_c->'casos_completos'),
      'comercial_primer_pago',       jsonb_build_array(k_sep_a->'primer_pago', k_sep_c->'primer_pago')
    ),
    'mes_en_curso', anio || '-' || mes,
    'delta_mes_en_curso', jsonb_build_object(
      'direccion_primer_pago', (dir_mes_c->>'primer_pago')::numeric - (dir_mes_a->>'primer_pago')::numeric,
      'direccion_negocios_cerrados', (dir_mes_c->>'negocios_cerrados')::int - (dir_mes_a->>'negocios_cerrados')::int
    ),
    'tasa_cancelacion_mes', jsonb_build_object(
      'n_perdidos', jsonb_build_array(k_mes_a->'n_perdidos', k_mes_c->'n_perdidos'),
      'tasa',       jsonb_build_array(k_mes_a->'tasa_cancelacion', k_mes_c->'tasa_cancelacion')
    ),
    'reembolsos_mes', re_mes - 'anterior',
    'reembolsos_septiembre', jsonb_build_object('reembolsos', re_sep->'reembolsos', 'valor', re_sep->'valor')
  );

  RAISE EXCEPTION 'DRYRUN %', jsonb_pretty(r);
END
$dry$;
