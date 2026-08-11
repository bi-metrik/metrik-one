-- ============================================================================
-- El valor de un negocio se desglosa en UN solo lugar: v_negocio_valor.
--
-- `negocios.precio_aprobado` guarda el honorario CON IVA. Hasta hoy cada
-- consumidor decidia por su cuenta si lo descontaba, y no todos lo hacian:
--   get_comercial_kpis_mes_soena       dividia por el literal 1.19
--   get_comercial_serie_mensual_soena  dividia por el literal 1.19
--   get_comercial_perfil_soena         no
--   get_comercial_resumen_soena        no
--   count_negocios_por_conciliar       no
--   v_mc_negocio                       no  <- el mas grave
--
-- En v_mc_negocio el margen de contribucion comparaba un ingreso CON IVA contra
-- costos SIN IVA (los gastos de comision ePayco ya separan el impuesto a
-- `impuestos_recuperables`, no_operativo, desde 20260622000002). El IVA no es
-- ingreso: es plata que se recauda para la DIAN. Ese margen estaba inflado en el
-- 19% del precio y cualquier decision tomada mirandolo iba sesgada al alza.
--
-- Mismo patron de fuente unica que v_negocio_comercial (atribucion comercial) y
-- misma leccion que la formula de saldo escrita en siete sitios: mientras cada
-- funcion decida por su cuenta, se desincronizan y nadie se entera.
--
-- QUE MUESTRA CADA INDICADOR (la decision, que hasta hoy no estaba tomada en
-- ninguna parte, solo ocurria). Detalle y motivos en
-- docs/specs/2026-08-10_valor-negocio-base-iva.md:
--   * Comercial (venta, ticket, metas, MC)  -> BASE, sin IVA. Es el ingreso real.
--   * Cartera y conciliacion (saldo, valor a
--     recaudar, sobrepagos, recaudo)        -> TOTAL, con IVA. Es lo que el
--                                              cliente paga.
-- Una cifra de recaudo NUNCA se compara contra una base sin IVA: eso daba por
-- cobrado un caso al 84%.
--
-- El porcentaje de IVA sale de la configuracion, NO del literal 1.19. Cadena de
-- resolucion, por negocio, con el origen expuesto en la vista:
--   1. `propuesta`    la propuesta economica aprobada del negocio (data.iva_pct)
--   2. `servicio`     servicios.tarifa_iva del servicio que declara su bloque
--   3. `workspace`    workspaces.config_extra->'honorario'->>'iva_pct'
--   4. `sin_declarar` no hay dato -> iva_frac 0 (base = total)
--
-- Sobre el paso 4: NO se asume 19% para quien no lo declaro. Medido el
-- 2026-08-10 en produccion (ensayo en transaccion con rollback): resuelven los
-- 265 negocios de SOENA, 66 por su propuesta aprobada y 199 por el servicio de
-- su linea, todos 0.19. Quedan sin declarar afi (53), metrik (26), ana-demo (5),
-- advise (2), wmc-sm (2) y dimpro (1): nadie ha dicho todavia si esos precios
-- incluyen IVA. Para ellos el comportamiento es IDENTICO al de hoy —verificado,
-- su MC no se mueve ni un peso— y la vista lo dice (`iva_declarado` false) en
-- vez de callarlo. Declararlo es una linea de config, no un deploy.
--
-- Elegir 19% por defecto habria movido las cifras de cinco workspaces sobre una
-- suposicion que nadie pidio; elegir 0 conserva lo que hay hasta que alguien
-- responda. El umbral esta medido y va en el spec: si declararan 19%, el MC
-- acumulado baja $35,5M en wmc-sm, $31,9M en metrik, $9,9M en ana-demo, $7,4M en
-- afi, $1,8M en dimpro y $431 en advise.
-- ============================================================================

-- ── 1. Fuente unica del desglose ────────────────────────────────────────────

create or replace view v_negocio_valor as
with propuesta as (
  -- La propuesta APROBADA mas reciente del negocio. Solo aporta la tarifa de
  -- IVA: el monto lo manda `negocios.precio_aprobado`, que es lo que corrige
  -- "Corregir valor aprobado" y lo que consumen cartera y la emision en Siigo.
  -- Medido el 2026-08-10: en 2 casos de SOENA el bloque y el precio difieren
  -- (V0259 637.500 vs 510.000; V0097 637.585 vs 637.500) y la version del
  -- bloque es la vieja.
  select distinct on (nb.negocio_id)
    nb.negocio_id,
    nullif(nb.data->>'iva_pct','')::numeric as iva_pct
  from negocio_bloques nb
  join bloque_configs bc     on bc.id = nb.bloque_config_id
  join bloque_definitions bd on bd.id = bc.bloque_definition_id
  where bd.tipo = 'propuesta_economica'
    and (nb.data->>'aprobado_at') is not null
    and nullif(nb.data->>'iva_pct','') is not null
  order by nb.negocio_id, (nb.data->>'aprobado_at')::timestamptz desc
),
servicio as (
  -- El servicio que declara el bloque de propuesta de la LINEA del negocio, por
  -- la misma via que usa la aplicacion (`config_extra.auto_propuesta.servicio_id`).
  --
  -- Se resuelve por linea y no por la instancia del bloque en el negocio: 44 de
  -- los 265 negocios de SOENA nunca instanciaron ese bloque (son anteriores a
  -- el, o entraron por cargue) y por instancia se habrian quedado sin declarar,
  -- o sea con el margen inflado, que es justo lo que este cambio corrige.
  --
  -- Si una linea alcanza DOS tarifas distintas, no se elige una: se deja pasar
  -- al siguiente escalon. Un parametro ambiguo no se resuelve por comodidad.
  select linea_id, min(tarifa_iva) as tarifa_iva
  from (
    select distinct e.linea_id, s.tarifa_iva
    from bloque_configs bc
    join etapas_negocio e on e.id = bc.etapa_id
    join servicios s
      on s.id::text = coalesce(
           bc.config_extra->'auto_propuesta'->>'servicio_id',
           bc.config_extra->>'servicio_id')
    where s.tarifa_iva is not null
  ) t
  group by linea_id
  having count(*) = 1
),
resuelto as (
  select
    n.id                as negocio_id,
    n.workspace_id,
    n.precio_aprobado,
    n.precio_estimado,
    case
      when p.iva_pct    is not null then 'propuesta'
      when sv.tarifa_iva is not null then 'servicio'
      when nullif(w.config_extra->'honorario'->>'iva_pct','') is not null then 'workspace'
      else 'sin_declarar'
    end as iva_origen,
    -- Normalizacion en UN solo sitio: la tarifa se ha guardado como fraccion
    -- (0.19) y como porcentaje (19) segun quien la escribiera.
    case
      when p.iva_pct is not null
        then case when p.iva_pct > 1 then p.iva_pct / 100 else p.iva_pct end
      when sv.tarifa_iva is not null
        then case when sv.tarifa_iva > 1 then sv.tarifa_iva / 100 else sv.tarifa_iva end
      when nullif(w.config_extra->'honorario'->>'iva_pct','') is not null
        then case
               when (w.config_extra->'honorario'->>'iva_pct')::numeric > 1
                 then (w.config_extra->'honorario'->>'iva_pct')::numeric / 100
               else (w.config_extra->'honorario'->>'iva_pct')::numeric
             end
      else 0
    end as iva_frac
  from negocios n
  left join propuesta  p  on p.negocio_id = n.id
  left join servicio   sv on sv.linea_id  = n.linea_id
  left join workspaces w  on w.id = n.workspace_id
)
select
  r.negocio_id,
  r.workspace_id,
  r.iva_frac,
  r.iva_origen,
  (r.iva_origen <> 'sin_declarar') as iva_declarado,

  -- Valor APROBADO. NULL mientras no haya honorario aprobado: un negocio sin
  -- precio no vale cero, no vale todavia. Lo usa lo comercial.
  r.precio_aprobado                                                  as valor_aprobado_total,
  round(r.precio_aprobado / (1 + r.iva_frac), 2)                     as valor_aprobado_base,
  r.precio_aprobado - round(r.precio_aprobado / (1 + r.iva_frac), 2) as valor_aprobado_iva,

  -- Valor VIGENTE, con respaldo en el estimado. Nunca nulo. Lo usan el margen y
  -- la cartera, que necesitan una cifra aunque el precio no este aprobado.
  coalesce(r.precio_aprobado, r.precio_estimado, 0)                                       as valor_total,
  round(coalesce(r.precio_aprobado, r.precio_estimado, 0) / (1 + r.iva_frac), 2)          as valor_base,
  coalesce(r.precio_aprobado, r.precio_estimado, 0)
    - round(coalesce(r.precio_aprobado, r.precio_estimado, 0) / (1 + r.iva_frac), 2)      as valor_iva,
  (r.precio_aprobado is null and r.precio_estimado is not null)                           as es_estimado
from resuelto r;

comment on view v_negocio_valor is
  'Fuente unica del desglose de valor de un negocio: total (con IVA), base (sin IVA) e IVA. '
  'La tarifa sale de la propuesta aprobada, del servicio o de la config del workspace, en ese '
  'orden; nunca de un literal. iva_declarado=false significa que nadie declaro si ese precio '
  'incluye IVA, y entonces base = total (comportamiento previo, no un supuesto nuevo).';

-- security_invoker: la vista respeta el RLS de quien consulta. Sin esto, un
-- authenticated leeria los precios de todos los workspaces (incidente del
-- 2026-06-02 con las 7 vistas financieras).
alter view v_negocio_valor set (security_invoker = on);
revoke all on v_negocio_valor from anon;
grant select on v_negocio_valor to authenticated;

-- ── 2. Margen de contribucion: base contra costos ───────────────────────────
-- Se recrea con DROP+CREATE porque agrega columnas (convencion del repo).

drop view if exists v_mc_negocio;

create view v_mc_negocio as
select
  n.id                as negocio_id,
  n.workspace_id,
  n.codigo            as negocio_codigo,
  n.nombre            as negocio_nombre,
  n.precio_aprobado,
  n.precio_estimado,
  n.estado,
  n.stage_actual,
  -- Desglose, para que la pantalla pueda mostrar sobre que se calculo el margen.
  v.valor_total,
  v.valor_base,
  v.valor_iva,
  v.iva_frac,
  v.iva_origen,
  v.iva_declarado,
  coalesce(sum(g.monto), 0)                          as costos_variables,
  -- El IVA no es ingreso: se recauda para la DIAN. El margen compara BASE
  -- contra costos, que ya vienen sin impuesto recuperable.
  v.valor_base - coalesce(sum(g.monto), 0)           as mc,
  case
    when v.valor_base > 0
      then (v.valor_base - coalesce(sum(g.monto), 0)) / v.valor_base
    else null
  end                                                as mc_pct,
  count(g.id)                                        as gastos_count
from negocios n
join v_negocio_valor v on v.negocio_id = n.id
left join gastos g on g.negocio_id = n.id and g.clasificacion_costo = 'variable'
group by n.id, n.workspace_id, n.codigo, n.nombre, n.precio_aprobado, n.precio_estimado,
         n.estado, n.stage_actual, v.valor_total, v.valor_base, v.valor_iva,
         v.iva_frac, v.iva_origen, v.iva_declarado;

comment on view v_mc_negocio is
  'Margen de contribucion por negocio. Ingreso SIN IVA (v_negocio_valor.valor_base) contra '
  'costos variables. Antes del 2026-08-10 comparaba el precio CON IVA contra costos sin IVA y '
  'el margen salia inflado en el 19% del precio.';

alter view v_mc_negocio set (security_invoker = on);
revoke all on v_mc_negocio from anon;
grant select on v_mc_negocio to authenticated;

-- ── 3. Consumidores comerciales: valor sin IVA ──────────────────────────────

create or replace function public.get_comercial_kpis_mes_soena(
  p_workspace_id uuid, p_anio integer, p_mes integer
) returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  cobros_neg AS (
    SELECT
      c.negocio_id,
      MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante')  AS fecha_venta,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante')  AS honorario_recaudado,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante'
                             AND c.tipo_cobro IS DISTINCT FROM 'saldo')     AS primer_pago,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'saldo')                    AS segundo_pago,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'pasante')                  AS tarifa
    FROM cobros c, guard g
    WHERE c.workspace_id = g.id AND c.fecha IS NOT NULL
    GROUP BY c.negocio_id
  ),
  ventas_mes AS (
    SELECT
      n.id AS negocio_id,
      vc.comercial_staff_id AS responsable_id,
      cn.fecha_venta,
      -- Fuente unica del desglose. Lo comercial mide la BASE (ingreso real);
      -- el total con IVA queda a la vista para conciliar contra cartera.
      COALESCE(vv.valor_aprobado_total, 0)                                      AS honorario_con_iva,
      COALESCE(vv.valor_aprobado_base, 0)                                       AS honorario_sin_iva,
      COALESCE(cn.honorario_recaudado, 0)                                       AS honorario_recaudado,
      COALESCE(cn.primer_pago, 0)                                               AS primer_pago,
      COALESCE(cn.segundo_pago, 0)                                              AS segundo_pago,
      COALESCE(cn.tarifa, 0)                                                    AS tarifa,
      -- Lo recaudado llega CON IVA: se compara contra el total, no contra la
      -- base. Compararlo contra la base daba por completo un caso al 84%.
      (COALESCE(cn.honorario_recaudado, 0) >= COALESCE(vv.valor_aprobado_total, 0) - 1) AS caso_completo
    FROM negocios n
    JOIN guard g          ON n.workspace_id = g.id
    JOIN cobros_neg cn    ON cn.negocio_id = n.id AND cn.fecha_venta IS NOT NULL
    JOIN v_negocio_valor vv ON vv.negocio_id = n.id
    LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = n.id
    WHERE EXTRACT(YEAR  FROM cn.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM cn.fecha_venta) = p_mes
  ),
  cancelados_mes AS (
    SELECT COUNT(*) AS n_perdidos
    FROM negocios n, guard g
    WHERE n.workspace_id = g.id AND n.estado = 'perdido'
      AND EXTRACT(YEAR  FROM n.updated_at) = p_anio
      AND EXTRACT(MONTH FROM n.updated_at) = p_mes
  ),
  tot AS (
    SELECT
      COUNT(*)                                             AS num_ventas,
      COALESCE(SUM(honorario_sin_iva), 0)                  AS valor_sin_iva,
      COALESCE(SUM(honorario_con_iva), 0)                  AS valor_con_iva,
      COALESCE(SUM(primer_pago), 0)                        AS primer_pago,
      COALESCE(SUM(segundo_pago), 0)                       AS segundo_pago,
      COALESCE(SUM(honorario_recaudado), 0)                AS honorario_recaudado,
      COALESCE(SUM(tarifa), 0)                             AS tarifa,
      COUNT(*) FILTER (WHERE caso_completo)                AS casos_completos
    FROM ventas_mes
  ),
  meta_global AS (
    SELECT meta_num_ventas, meta_valor
    FROM metas_comerciales mc, guard g
    WHERE mc.workspace_id = g.id AND mc.staff_id IS NULL
      AND mc.anio = p_anio AND mc.mes = p_mes
    LIMIT 1
  ),
  por_dia AS (
    SELECT fecha_venta::date AS dia, COUNT(*) AS ventas_dia
    FROM ventas_mes GROUP BY fecha_venta::date
  ),
  mejor_dia AS (
    SELECT dia, ventas_dia FROM por_dia ORDER BY ventas_dia DESC, dia LIMIT 1
  )
  SELECT jsonb_build_object(
    'anio', p_anio,
    'mes', p_mes,
    'kpis', jsonb_build_object(
      'num_ventas',           (SELECT num_ventas FROM tot),
      'valor_sin_iva',        (SELECT valor_sin_iva FROM tot),
      'valor_con_iva',        (SELECT valor_con_iva FROM tot),
      'primer_pago',          (SELECT primer_pago FROM tot),
      'segundo_pago',         (SELECT segundo_pago FROM tot),
      'honorario_recaudado',  (SELECT honorario_recaudado FROM tot),
      'tarifa_recaudada',     (SELECT tarifa FROM tot),
      'casos_completos',      (SELECT casos_completos FROM tot),
      'tasa_casos_completos', CASE WHEN (SELECT num_ventas FROM tot) > 0
                                    THEN round(100.0 * (SELECT casos_completos FROM tot) / (SELECT num_ventas FROM tot), 1)
                                    ELSE NULL END,
      'ticket_promedio',      CASE WHEN (SELECT num_ventas FROM tot) > 0
                                    THEN round((SELECT valor_sin_iva FROM tot) / (SELECT num_ventas FROM tot), 0)
                                    ELSE 0 END,
      'mejor_dia',            (SELECT to_char(dia,'YYYY-MM-DD') FROM mejor_dia),
      'mejor_dia_ventas',     COALESCE((SELECT ventas_dia FROM mejor_dia), 0),
      'promedio_ventas_dia',  round((SELECT COALESCE(AVG(ventas_dia),0) FROM por_dia), 2),
      'ingreso_promedio_dia', CASE WHEN (SELECT COUNT(*) FROM por_dia) > 0
                                    THEN round((SELECT valor_sin_iva FROM tot) / (SELECT COUNT(*) FROM por_dia), 0)
                                    ELSE 0 END,
      'ventas_proyectadas',   CASE
        WHEN EXTRACT(YEAR FROM CURRENT_DATE) = p_anio AND EXTRACT(MONTH FROM CURRENT_DATE) = p_mes
          THEN round(
            (SELECT num_ventas FROM tot)::numeric
            * EXTRACT(DAY FROM (date_trunc('month', make_date(p_anio,p_mes,1)) + interval '1 month - 1 day'))
            / GREATEST(EXTRACT(DAY FROM CURRENT_DATE), 1), 1)
        ELSE (SELECT num_ventas FROM tot) END,
      'n_perdidos',           (SELECT n_perdidos FROM cancelados_mes),
      'tasa_cancelacion',     CASE WHEN ((SELECT num_ventas FROM tot) + (SELECT n_perdidos FROM cancelados_mes)) > 0
                                    THEN round(100.0 * (SELECT n_perdidos FROM cancelados_mes)
                                         / ((SELECT num_ventas FROM tot) + (SELECT n_perdidos FROM cancelados_mes)), 1)
                                    ELSE NULL END,
      -- Recaudo contra lo que el cliente debe pagar (CON IVA), no contra la base.
      'tasa_recaudo',         CASE WHEN (SELECT valor_con_iva FROM tot) > 0
                                    THEN round(100.0 * (SELECT honorario_recaudado FROM tot) / (SELECT valor_con_iva FROM tot), 1)
                                    ELSE NULL END,
      'meta_num_ventas',      (SELECT meta_num_ventas FROM meta_global),
      'meta_valor',           (SELECT meta_valor FROM meta_global),
      'cumplimiento_num',     CASE WHEN (SELECT meta_num_ventas FROM meta_global) > 0
                                    THEN round(100.0 * (SELECT num_ventas FROM tot) / (SELECT meta_num_ventas FROM meta_global), 1)
                                    ELSE NULL END,
      'cumplimiento_valor',   CASE WHEN (SELECT meta_valor FROM meta_global) > 0
                                    THEN round(100.0 * (SELECT valor_sin_iva FROM tot) / (SELECT meta_valor FROM meta_global), 1)
                                    ELSE NULL END
    ),
    'porDia', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('dia', to_char(dia,'YYYY-MM-DD'), 'ventas', ventas_dia) ORDER BY dia)
      FROM por_dia
    ), '[]'::jsonb),
    'porVendedor', COALESCE((
      SELECT jsonb_agg(row ORDER BY nventas DESC, nombre)
      FROM (
        SELECT jsonb_build_object(
          'responsable_id',       vm.responsable_id,
          'nombre',               COALESCE(s.full_name, '(sin responsable)'),
          'sin_responsable',      vm.responsable_id IS NULL,
          'es_lider',             COALESCE(bool_or(pf.role IN ('owner','admin','supervisor')), false),
          'num_ventas',           COUNT(*),
          'valor_sin_iva',        COALESCE(SUM(vm.honorario_sin_iva), 0),
          'valor_con_iva',        COALESCE(SUM(vm.honorario_con_iva), 0),
          'primer_pago',          COALESCE(SUM(vm.primer_pago), 0),
          'segundo_pago',         COALESCE(SUM(vm.segundo_pago), 0),
          'casos_completos',      COUNT(*) FILTER (WHERE vm.caso_completo),
          'tasa_casos_completos', CASE WHEN COUNT(*) > 0
                                       THEN round(100.0 * COUNT(*) FILTER (WHERE vm.caso_completo) / COUNT(*), 1)
                                       ELSE NULL END,
          'participacion_pct',    CASE WHEN (SELECT num_ventas FROM tot) > 0
                                       THEN round(100.0 * COUNT(*) / (SELECT num_ventas FROM tot), 1)
                                       ELSE NULL END,
          'meta_num_ventas',      (SELECT meta_num_ventas FROM metas_comerciales mc, guard g
                                    WHERE mc.workspace_id=g.id AND mc.staff_id=vm.responsable_id
                                      AND mc.anio=p_anio AND mc.mes=p_mes LIMIT 1),
          'meta_valor',           (SELECT meta_valor FROM metas_comerciales mc, guard g
                                    WHERE mc.workspace_id=g.id AND mc.staff_id=vm.responsable_id
                                      AND mc.anio=p_anio AND mc.mes=p_mes LIMIT 1)
        ) AS row,
        COUNT(*) AS nventas,
        COALESCE(s.full_name,'(sin responsable)') AS nombre
        FROM ventas_mes vm
        LEFT JOIN staff s     ON s.id = vm.responsable_id
        LEFT JOIN profiles pf ON pf.id = s.profile_id
        GROUP BY vm.responsable_id, s.full_name
      ) t
    ), '[]'::jsonb)
  );
$function$;

revoke execute on function public.get_comercial_kpis_mes_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_comercial_kpis_mes_soena(uuid, integer, integer) to authenticated;

create or replace function public.get_comercial_serie_mensual_soena(
  p_workspace_id uuid, p_meses integer default 12
) returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  meses AS (
    SELECT date_trunc('month', CURRENT_DATE) - (n || ' month')::interval AS mes_ini
    FROM generate_series(0, GREATEST(p_meses,1) - 1) n
  ),
  ventas AS (
    SELECT
      n.id AS negocio_id,
      MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') AS fecha_venta,
      COALESCE(vv.valor_aprobado_base, 0)  AS honorario_sin_iva,
      COALESCE(vv.valor_aprobado_total, 0) AS honorario_con_iva
    FROM negocios n
    JOIN guard g            ON n.workspace_id = g.id
    JOIN cobros c           ON c.negocio_id = n.id AND c.workspace_id = g.id AND c.fecha IS NOT NULL
    JOIN v_negocio_valor vv ON vv.negocio_id = n.id
    GROUP BY n.id, vv.valor_aprobado_base, vv.valor_aprobado_total
    HAVING MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') IS NOT NULL
  ),
  ventas_por_mes AS (
    SELECT
      date_trunc('month', fecha_venta) AS mes_ini,
      COUNT(*) AS num_ventas,
      SUM(honorario_sin_iva) AS valor_sin_iva,
      SUM(honorario_con_iva) AS valor_con_iva
    FROM ventas GROUP BY 1
  ),
  recaudo_por_mes AS (
    SELECT
      date_trunc('month', c.fecha) AS mes_ini,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante')                                   AS honorario_recaudado,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante' AND c.tipo_cobro IS DISTINCT FROM 'saldo') AS primer_pago,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'saldo')                                                    AS segundo_pago,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'pasante')                                                  AS tarifa
    FROM cobros c, guard g
    WHERE c.workspace_id = g.id AND c.fecha IS NOT NULL
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'serie', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'anio',                EXTRACT(YEAR  FROM m.mes_ini)::int,
        'mes',                 EXTRACT(MONTH FROM m.mes_ini)::int,
        'label',               to_char(m.mes_ini, 'Mon YY'),
        'num_ventas',          COALESCE(vm.num_ventas, 0),
        'valor_sin_iva',       COALESCE(vm.valor_sin_iva, 0),
        'valor_con_iva',       COALESCE(vm.valor_con_iva, 0),
        'honorario_recaudado', COALESCE(rm.honorario_recaudado, 0),
        'primer_pago',         COALESCE(rm.primer_pago, 0),
        'segundo_pago',        COALESCE(rm.segundo_pago, 0),
        'tarifa_recaudada',    COALESCE(rm.tarifa, 0)
      ) ORDER BY m.mes_ini)
      FROM meses m
      LEFT JOIN ventas_por_mes  vm ON vm.mes_ini = m.mes_ini
      LEFT JOIN recaudo_por_mes rm ON rm.mes_ini = m.mes_ini
    ), '[]'::jsonb),
    -- Recaudo (CON IVA) contra valor vendido CON IVA: las dos cifras del mismo lado.
    'tasa_recaudo_global', (
      SELECT CASE WHEN SUM(vm.valor_con_iva) > 0
                  THEN round(100.0 * COALESCE((SELECT SUM(honorario_recaudado) FROM recaudo_por_mes), 0)
                       / SUM(vm.valor_con_iva), 1)
                  ELSE NULL END
      FROM ventas_por_mes vm
    )
  );
$function$;

revoke execute on function public.get_comercial_serie_mensual_soena(uuid, integer) from public, anon;
grant  execute on function public.get_comercial_serie_mensual_soena(uuid, integer) to authenticated;

create or replace function public.get_comercial_resumen_soena(
  p_workspace_id uuid, p_anio integer default null, p_mes integer default null
) returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  cobros_neg AS (
    SELECT
      c.negocio_id,
      MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') AS fecha_venta,
      SUM(c.monto) FILTER (
        WHERE c.tipo_cobro IS DISTINCT FROM 'pasante'
          AND (p_anio IS NULL OR (EXTRACT(YEAR FROM c.fecha) = p_anio AND EXTRACT(MONTH FROM c.fecha) = p_mes))
      ) AS honorario,
      SUM(c.monto) FILTER (
        WHERE c.tipo_cobro = 'pasante'
          AND (p_anio IS NULL OR (EXTRACT(YEAR FROM c.fecha) = p_anio AND EXTRACT(MONTH FROM c.fecha) = p_mes))
      ) AS tarifa
    FROM cobros c, guard g
    WHERE c.workspace_id = g.id AND c.fecha IS NOT NULL
    GROUP BY c.negocio_id
  ),
  base AS (
    SELECT
      vc.comercial_staff_id AS responsable_id,
      n.stage_actual,
      n.estado,
      -- Comercial mide sin IVA; el total con IVA viaja al lado para cartera.
      COALESCE(vv.valor_aprobado_base, 0)  AS valor_sin_iva,
      COALESCE(vv.valor_aprobado_total, 0) AS valor_con_iva,
      cn.fecha_venta,
      (cn.fecha_venta IS NOT NULL
        AND (p_anio IS NULL
             OR (EXTRACT(YEAR FROM cn.fecha_venta) = p_anio AND EXTRACT(MONTH FROM cn.fecha_venta) = p_mes)))
                                          AS es_venta_periodo,
      COALESCE(cn.honorario, 0)           AS honorario_recaudado,
      COALESCE(cn.tarifa, 0)              AS tarifa_recaudada
    FROM negocios n
    CROSS JOIN guard g
    JOIN v_negocio_valor vv ON vv.negocio_id = n.id
    LEFT JOIN cobros_neg cn ON cn.negocio_id = n.id
    LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = n.id
    WHERE n.workspace_id = g.id
  ),
  por_resp AS (
    SELECT
      b.responsable_id,
      COUNT(*)                                                      AS negocios_total,
      COUNT(*) FILTER (WHERE b.estado = 'abierto')                 AS negocios_abiertos,
      COUNT(*) FILTER (WHERE b.es_venta_periodo)                   AS num_ventas,
      COUNT(*) FILTER (WHERE b.stage_actual = 'venta')             AS en_venta,
      COUNT(*) FILTER (WHERE b.stage_actual = 'ejecucion')         AS en_ejecucion,
      COUNT(*) FILTER (WHERE b.stage_actual = 'cobro')             AS en_cobro,
      COUNT(*) FILTER (WHERE b.stage_actual = 'cerrado'
                          OR b.estado = 'completado')              AS cerrados,
      COALESCE(SUM(b.valor_sin_iva), 0)                            AS valor_aprobado,
      COALESCE(SUM(b.valor_con_iva), 0)                            AS valor_aprobado_con_iva,
      COALESCE(SUM(b.honorario_recaudado), 0)                      AS honorario_recaudado,
      COALESCE(SUM(b.tarifa_recaudada), 0)                         AS tarifa_recaudada
    FROM base b
    GROUP BY b.responsable_id
  )
  SELECT COALESCE(
    (SELECT jsonb_agg(x ORDER BY val DESC, nombre)
     FROM (
       SELECT
         jsonb_build_object(
           'responsable_id',        pr.responsable_id,
           'nombre',                COALESCE(s.full_name, '(sin responsable)'),
           'position',              s.position,
           'es_lider',              COALESCE(pf.role IN ('owner','admin','supervisor'), false),
           'sin_responsable',       pr.responsable_id IS NULL,
           'negocios_total',        pr.negocios_total,
           'negocios_abiertos',     pr.negocios_abiertos,
           'num_ventas',            pr.num_ventas,
           'en_venta',              pr.en_venta,
           'en_ejecucion',          pr.en_ejecucion,
           'en_cobro',              pr.en_cobro,
           'cerrados',              pr.cerrados,
           'valor_aprobado',        pr.valor_aprobado,
           'valor_aprobado_con_iva', pr.valor_aprobado_con_iva,
           'honorario_recaudado',   pr.honorario_recaudado,
           'tarifa_recaudada',      pr.tarifa_recaudada
         ) AS x,
         pr.num_ventas AS val,
         COALESCE(s.full_name, '(sin responsable)') AS nombre
       FROM por_resp pr
       LEFT JOIN staff s    ON s.id = pr.responsable_id
       LEFT JOIN profiles pf ON pf.id = s.profile_id
     ) t),
    '[]'::jsonb
  );
$function$;

revoke execute on function public.get_comercial_resumen_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_comercial_resumen_soena(uuid, integer, integer) to authenticated;

create or replace function public.get_comercial_perfil_soena(
  p_responsable_id uuid, p_anio integer default null, p_mes integer default null
) returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  WITH ws AS (SELECT current_user_workspace_id() AS id),
  cobros_neg AS (
    SELECT
      c.negocio_id,
      MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') AS fecha_venta,
      SUM(c.monto) FILTER (
        WHERE c.tipo_cobro IS DISTINCT FROM 'pasante'
          AND (p_anio IS NULL OR (EXTRACT(YEAR FROM c.fecha) = p_anio AND EXTRACT(MONTH FROM c.fecha) = p_mes))
      ) AS honorario,
      SUM(c.monto) FILTER (
        WHERE c.tipo_cobro = 'pasante'
          AND (p_anio IS NULL OR (EXTRACT(YEAR FROM c.fecha) = p_anio AND EXTRACT(MONTH FROM c.fecha) = p_mes))
      ) AS tarifa
    FROM cobros c, ws
    WHERE c.workspace_id = ws.id AND c.fecha IS NOT NULL
    GROUP BY c.negocio_id
  ),
  base AS (
    SELECT
      n.id,
      n.codigo,
      n.nombre,
      n.stage_actual,
      n.estado,
      n.etapa_cambiada_at,
      e.nombre                        AS etapa_nombre,
      e.numero                        AS etapa_numero,
      (e.config_extra->>'sla_horas')::integer AS sla_horas,
      -- Venta = sin IVA (ingreso real). Cartera = con IVA (lo que falta cobrar).
      COALESCE(vv.valor_aprobado_base, 0)  AS valor_sin_iva,
      COALESCE(vv.valor_aprobado_total, 0) AS valor_con_iva,
      cn.fecha_venta,
      (cn.fecha_venta IS NOT NULL
        AND (p_anio IS NULL
             OR (EXTRACT(YEAR FROM cn.fecha_venta) = p_anio AND EXTRACT(MONTH FROM cn.fecha_venta) = p_mes)))
                                      AS es_venta_periodo,
      COALESCE(cn.honorario, 0)       AS honorario_recaudado,
      COALESCE(cn.tarifa, 0)          AS tarifa_recaudada,
      GREATEST(COALESCE(vv.valor_aprobado_total,0) - COALESCE(cn.honorario,0), 0) AS pendiente_honorario,
      CASE
        WHEN n.estado <> 'abierto' THEN 'sin_sla'
        WHEN (e.config_extra->>'sla_horas') IS NULL THEN 'sin_sla'
        WHEN horas_habiles_entre(n.etapa_cambiada_at, now()) > (e.config_extra->>'sla_horas')::numeric THEN 'vencido'
        ELSE 'a_tiempo'
      END AS sla_estado
    FROM negocios n
    CROSS JOIN ws
    JOIN v_negocio_valor vv    ON vv.negocio_id = n.id
    LEFT JOIN cobros_neg cn    ON cn.negocio_id = n.id
    LEFT JOIN etapas_negocio e ON e.id = n.etapa_actual_id
    LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = n.id
    WHERE n.workspace_id = ws.id
      AND vc.comercial_staff_id IS NOT DISTINCT FROM p_responsable_id
  ),
  meses AS (
    SELECT date_trunc('month', CURRENT_DATE) - (n || ' month')::interval AS mes_ini
    FROM generate_series(0, 11) n
  ),
  ventas_mes AS (
    SELECT date_trunc('month', fecha_venta) AS mes_ini, COUNT(*) AS num_ventas,
           COALESCE(SUM(valor_sin_iva),0) AS valor
    FROM base WHERE fecha_venta IS NOT NULL
    GROUP BY 1
  ),
  recaudo_mes AS (
    SELECT date_trunc('month', c.fecha) AS mes_ini,
           SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') AS honorario
    FROM cobros c
    CROSS JOIN ws
    JOIN negocios n ON n.id = c.negocio_id
    LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = n.id
    WHERE c.workspace_id = ws.id AND c.fecha IS NOT NULL
      AND vc.comercial_staff_id IS NOT DISTINCT FROM p_responsable_id
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'responsable_id', p_responsable_id,
    'nombre',         COALESCE((SELECT full_name FROM staff WHERE id = p_responsable_id), '(sin responsable)'),
    'position',       (SELECT position FROM staff WHERE id = p_responsable_id),
    'sin_responsable', p_responsable_id IS NULL,
    'anio', p_anio,
    'mes', p_mes,
    'kpis', (
      SELECT jsonb_build_object(
        'negocios_total',       COUNT(*),
        'negocios_abiertos',    COUNT(*) FILTER (WHERE estado = 'abierto'),
        'num_ventas',           COUNT(*) FILTER (WHERE es_venta_periodo),
        'valor_aprobado',       COALESCE(SUM(valor_sin_iva), 0),
        'valor_aprobado_con_iva', COALESCE(SUM(valor_con_iva), 0),
        'honorario_recaudado',  COALESCE(SUM(honorario_recaudado), 0),
        'tarifa_recaudada',     COALESCE(SUM(tarifa_recaudada), 0),
        'pendiente_honorario',  COALESCE(SUM(pendiente_honorario), 0),
        'vencidos',             COUNT(*) FILTER (WHERE sla_estado = 'vencido')
      ) FROM base
    ),
    'porStage', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'stage', stage, 'negocios', cnt, 'valor_aprobado', val, 'pendiente_honorario', pend
      ) ORDER BY ord)
      FROM (
        SELECT COALESCE(stage_actual, '(sin stage)') AS stage, COUNT(*) AS cnt,
          COALESCE(SUM(valor_sin_iva), 0) AS val, COALESCE(SUM(pendiente_honorario), 0) AS pend,
          MIN(CASE stage_actual WHEN 'venta' THEN 1 WHEN 'ejecucion' THEN 2
                WHEN 'cobro' THEN 3 WHEN 'cerrado' THEN 4 ELSE 5 END) AS ord
        FROM base GROUP BY stage_actual
      ) s
    ), '[]'::jsonb),
    'porEtapa', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'etapa_numero', etapa_numero, 'etapa_nombre', COALESCE(etapa_nombre, '(sin etapa)'),
        'stage', stage_actual, 'negocios', cnt, 'valor_aprobado', val, 'pendiente_honorario', pend
      ) ORDER BY etapa_numero NULLS LAST)
      FROM (
        SELECT etapa_numero, etapa_nombre, stage_actual, COUNT(*) cnt,
          COALESCE(SUM(valor_sin_iva),0) val, COALESCE(SUM(pendiente_honorario),0) pend
        FROM base GROUP BY etapa_numero, etapa_nombre, stage_actual
      ) e
    ), '[]'::jsonb),
    'serie', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'anio', EXTRACT(YEAR FROM m.mes_ini)::int,
        'mes', EXTRACT(MONTH FROM m.mes_ini)::int,
        'label', to_char(m.mes_ini, 'Mon YY'),
        'num_ventas', COALESCE(vm.num_ventas, 0),
        'valor_aprobado', COALESCE(vm.valor, 0),
        'honorario_recaudado', COALESCE(rm.honorario, 0)
      ) ORDER BY m.mes_ini)
      FROM meses m
      LEFT JOIN ventas_mes vm ON vm.mes_ini = m.mes_ini
      LEFT JOIN recaudo_mes rm ON rm.mes_ini = m.mes_ini
    ), '[]'::jsonb),
    'negocios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'codigo', codigo, 'nombre', nombre, 'stage', stage_actual, 'estado', estado,
        'etapa_nombre', etapa_nombre, 'etapa_numero', etapa_numero,
        'es_venta', es_venta_periodo, 'fecha_venta', fecha_venta,
        'ultimo_avance', etapa_cambiada_at, 'sla_horas', sla_horas, 'sla_estado', sla_estado,
        'valor_aprobado', valor_sin_iva, 'valor_aprobado_con_iva', valor_con_iva,
        'honorario_recaudado', honorario_recaudado,
        'tarifa_recaudada', tarifa_recaudada, 'pendiente_honorario', pendiente_honorario
      ) ORDER BY valor_sin_iva DESC, nombre)
      FROM base
    ), '[]'::jsonb)
  );
$function$;

revoke execute on function public.get_comercial_perfil_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_comercial_perfil_soena(uuid, integer, integer) to authenticated;

-- ── 4. Conciliacion: la cartera se mide CON IVA, y ahora lo dice ────────────
-- No cambia ninguna cifra: `valor_a_recaudar` ya usaba el precio con IVA, que es
-- lo correcto (es lo que el cliente paga). Lo que cambia es que deja de leer la
-- columna cruda y lo toma de la fuente unica, para que el dia que el desglose
-- cambie no haya que acordarse de este sitio.

create or replace function public.count_negocios_por_conciliar(p_workspace_id uuid)
returns integer
language sql stable security definer set search_path to 'public'
as $function$
  with
  cobrado as (
    select c.negocio_id, sum(c.monto) as total
    from public.cobros c
    where c.workspace_id = p_workspace_id
      and coalesce(c.tipo_cobro, '') <> 'devolucion_pendiente'
    group by c.negocio_id
  ),
  tarifa_confirmada as (
    select nb.negocio_id,
           max((nb.data ->> 'tarifa_upme_confirmada')::numeric) as tarifa
    from public.negocio_bloques nb
    join public.bloque_configs bc on bc.id = nb.bloque_config_id
    join public.negocios n on n.id = nb.negocio_id
    where n.workspace_id = p_workspace_id
      and bc.config_extra -> 'tarifa_confirmacion' ->> 'enabled' = 'true'
      and nb.data ->> 'tarifa_confirmada' = 'true'
      and nb.data ->> 'tarifa_upme_confirmada' ~ '^[0-9]+(\.[0-9]+)?$'
      and (nb.data ->> 'tarifa_upme_confirmada')::numeric > 0
    group by nb.negocio_id
  ),
  sin_certificacion as (
    select distinct nb.negocio_id
    from public.negocio_bloques nb
    join public.bloque_configs bc on bc.id = nb.bloque_config_id
    join public.negocios n on n.id = nb.negocio_id
    where n.workspace_id = p_workspace_id
      and bc.slug = 'certificacion_upme'
      and nb.data -> 'requiere_certificacion_upme' = 'false'::jsonb
  ),
  valor_a_recaudar as (
    -- CON IVA a proposito: es la plata que entra a la cuenta, contra la que se
    -- comparan los pagos. La tarifa UPME no lleva IVA (se recauda y se gira).
    select n.id as negocio_id,
           vv.valor_total
             + case when sc.negocio_id is not null then 0 else coalesce(t.tarifa, 0) end as valor
    from public.negocios n
    join public.v_negocio_valor vv on vv.negocio_id = n.id
    left join tarifa_confirmada t on t.negocio_id = n.id
    left join sin_certificacion sc on sc.negocio_id = n.id
    where n.workspace_id = p_workspace_id
  ),
  sobrepagos as (
    select n.id
    from public.negocios n
    join cobrado cb on cb.negocio_id = n.id
    join valor_a_recaudar vr on vr.negocio_id = n.id
    left join public.negocio_conciliacion nc on nc.negocio_id = n.id
    where n.workspace_id = p_workspace_id
      and n.estado = 'abierto'
      and cb.total - vr.valor > 1000
      and coalesce(nc.conciliado, false) = false
  ),
  refs_no_split as (
    select c.external_ref, c.negocio_id
    from public.cobros c
    join public.negocios n on n.id = c.negocio_id
    where c.workspace_id = p_workspace_id
      and c.external_ref is not null
      and (c.split_json ->> 'split_id') is null
      and n.estado = 'abierto'
  ),
  duplicados as (
    select distinct r.negocio_id as id
    from refs_no_split r
    where r.external_ref in (
      select external_ref
      from refs_no_split
      group by external_ref
      having count(distinct negocio_id) > 1
    )
  ),
  etiquetados as (
    select distinct al.entidad_id as id
    from public.activity_log al
    where al.workspace_id = p_workspace_id
      and al.entidad_tipo = 'negocio'
      and al.tipo = 'solicitud_conciliacion'
      and exists (
        select 1 from public.negocios n3
        where n3.id = al.entidad_id
          and n3.workspace_id = p_workspace_id
          and n3.estado = 'abierto'
      )
      and not exists (
        select 1 from public.activity_log al2
        where al2.workspace_id = p_workspace_id
          and al2.entidad_tipo = 'negocio'
          and al2.entidad_id = al.entidad_id
          and al2.tipo = 'conciliacion_atendida'
          and al2.created_at > al.created_at
      )
  )
  select count(*)::integer
  from (
    select id from sobrepagos
    union
    select id from duplicados
    union
    select id from etiquetados
  ) u;
$function$;

revoke execute on function public.count_negocios_por_conciliar(uuid) from public, anon;
grant  execute on function public.count_negocios_por_conciliar(uuid) to authenticated;
