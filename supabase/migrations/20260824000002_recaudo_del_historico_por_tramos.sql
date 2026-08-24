-- El historico mensual contaba la tarifa UPME como honorario
-- ==========================================================
--
-- `get_comercial_serie_mensual_soena` (que pinta "Recaudo por mes" y "1o vs 2o pago")
-- quedo con la regla VIEJA: separaba honorario de tarifa por la ETIQUETA del cobro
-- (`tipo_cobro = 'pasante'`) y el segundo pago por `tipo_cobro = 'saldo'`.
--
-- Esas dos etiquetas no se usan. Medido en el workspace de SOENA el 2026-08-24, los
-- unicos `tipo_cobro` vivos son `anticipo` (197), `pago` (55) y `externo` (8):
-- CERO `pasante` y CERO `saldo`. Consecuencias, las dos visibles en pantalla:
--
--   1. Toda la tarifa UPME se estaba sumando como recaudo propio. Agosto-2026 pintaba
--      $45.305.692 cuando el honorario real fue $20.033.000 — **$25.148.853 de plata de
--      terceros contada como ingreso**. Julio: $39.783.827 pintados contra $29.441.246
--      reales. La cabecera de esa misma pestana dice "El recaudo es honorario (ingreso
--      real); la tarifa UPME se reporta aparte como plata de terceros": el grafico
--      contradecia a su propio encabezado.
--   2. La barra ocre de "2o pago" era CERO en todos los meses por construccion. Los
--      $850.000 de julio (V0025 y V0099) que el KPI del mes si muestra nunca podian
--      aparecer ahi.
--
-- El resto del tablero ya no usa esa regla: `v_venta_mes_comercial` —y con ella
-- `get_comercial_kpis_mes_soena` y sus hermanas— imputa cada peso a su franja con
-- `v_cobro_valor` (tramo 1 -> tarifa -> tramo 2 -> excedente, en orden cronologico).
-- El historico se pasa a la misma fuente. No es un criterio nuevo: es el que ya rige
-- en todas las demas cifras de la pestana.
--
-- El lado de las VENTAS no se toca: se verifico mes a mes contra
-- `v_venta_mes_comercial` y da identico (ago: 38 ventas / $18.263.025,30 en ambos).
--
-- Sin DML: no se modifica ni una fila. Lo que cambia es lo que las barras dicen.

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
  -- Cada peso a su franja, no a su etiqueta. Misma fuente que el KPI del mes.
  recaudo_por_mes AS (
    SELECT
      date_trunc('month', cv.fecha) AS mes_ini,
      SUM(cv.a_tramo1 + cv.a_tramo2) AS honorario_recaudado,
      SUM(cv.a_tramo1)               AS primer_pago,
      SUM(cv.a_tramo2)               AS segundo_pago,
      SUM(cv.a_tarifa)               AS tarifa
    FROM v_cobro_valor cv, guard g
    WHERE cv.workspace_id = g.id AND cv.fecha IS NOT NULL
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
    -- Ahora el numerador es honorario de verdad, asi que la tasa deja de estar inflada
    -- por la tarifa de terceros.
    'tasa_recaudo_global', (
      SELECT CASE WHEN SUM(vm.valor_con_iva) > 0
                  THEN round(100.0 * COALESCE((SELECT SUM(honorario_recaudado) FROM recaudo_por_mes), 0)
                       / SUM(vm.valor_con_iva), 1)
                  ELSE NULL END
      FROM ventas_por_mes vm
    )
  );
$function$;

comment on function public.get_comercial_serie_mensual_soena(uuid, integer) is
  'Serie mensual del tablero comercial. Las ventas se cuentan por el primer cobro con '
  'fecha; el recaudo se imputa por franja con v_cobro_valor (tramo 1 / tarifa / tramo 2), '
  'la MISMA fuente que get_comercial_kpis_mes_soena — antes se separaba por tipo_cobro, '
  'etiqueta que no se usa, y la tarifa UPME se contaba como honorario.';

revoke execute on function public.get_comercial_serie_mensual_soena(uuid, integer) from public, anon;
grant  execute on function public.get_comercial_serie_mensual_soena(uuid, integer) to authenticated;


-- Los pagos que suman la barra del mes
-- ====================================
--
-- Hermana de `get_comercial_ventas_mes_soena`, y responde otra pregunta. Aquella abre
-- las VENTAS de un mes; esta abre los PAGOS que entraron en ese mes, que es lo que las
-- dos barras de recaudo cuentan. No son el mismo conjunto y por eso hacia falta: un
-- pago de agosto puede pertenecer a una venta de junio, asi que la lista de ventas de
-- agosto jamas reconstruiria la barra de recaudo de agosto.
--
-- Devuelve TODOS los cobros del mes con su desglose, no solo los que aportan honorario.
-- Si se filtraran, la suma de la lista cuadraria con la barra pero la pantalla no podria
-- explicar por que entraron $45M y solo $20M son ingreso: la tarifa quedaria invisible
-- otra vez, que es justo el defecto que esta migracion corrige.

create or replace function public.get_comercial_pagos_mes_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer
) returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  rango AS (
    SELECT make_date(p_anio, p_mes, 1) AS desde,
           (make_date(p_anio, p_mes, 1) + interval '1 month')::date AS hasta
  )
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'cobro_id',    cv.cobro_id,
      'fecha',       cv.fecha,
      'monto',       cv.monto,
      'honorario',   cv.a_tramo1 + cv.a_tramo2,
      'a_tramo1',    cv.a_tramo1,
      'a_tramo2',    cv.a_tramo2,
      'a_tarifa',    cv.a_tarifa,
      'excedente',   cv.excedente,
      'negocio_id',  cv.negocio_id,
      'codigo',      n.codigo,
      'nombre',      n.nombre,
      -- De que mes es la VENTA a la que se abona. Es la columna que explica por que la
      -- lista de ventas del mes no puede reconstruir esta barra.
      'fecha_venta', vm.fecha_venta
    ) ORDER BY cv.fecha DESC, cv.monto DESC)
    FROM v_cobro_valor cv
    JOIN guard g ON cv.workspace_id = g.id
    CROSS JOIN rango r
    LEFT JOIN negocios n                ON n.id = cv.negocio_id
    LEFT JOIN v_venta_mes_comercial vm  ON vm.negocio_id = cv.negocio_id
    WHERE cv.fecha >= r.desde AND cv.fecha < r.hasta
  ), '[]'::jsonb);
$function$;

comment on function public.get_comercial_pagos_mes_soena(uuid, integer, integer) is
  'Los cobros que entraron en un mes, con la imputacion de v_cobro_valor (tramo 1, '
  'tarifa, tramo 2, excedente) y el mes de la venta a la que se abonan. Alimenta el '
  'panel de las dos barras de recaudo del historico. server-only.';

revoke execute on function public.get_comercial_pagos_mes_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_comercial_pagos_mes_soena(uuid, integer, integer) to authenticated;
