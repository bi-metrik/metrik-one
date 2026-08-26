-- El historico mensual se puede mirar de una seccional a la vez.
--
-- Juan David, en la reunion del 2026-07-29 (ya solo con el, despues de la del equipo):
-- "quiero empezar a ver como desescalamos un poquito Bogota, pero subiendo ventas en
-- otras ciudades". Eso es una TENDENCIA por seccional, y el corte por seccional que ya
-- existe (`get_comercial_seccional_mes_soena`, punto #22) solo responde por UN mes.
-- Las cuatro graficas del historico —ventas, valor de negocio, recaudo y 1o vs 2o
-- pago— hoy solo saben del total.
--
-- Mauricio cerro el 2026-08-25: la unidad de analisis es la **seccional DIAN**, no el
-- municipio ("cada seccional de la DIAN debe trabajarse de manera independiente"), y la
-- fuente es **la seccional del RUT**, la misma con la que se arman los documentos.
--
-- ── Por que una RPC nueva y no un parametro en la vieja ─────────────────────────
--
-- `get_comercial_serie_mensual_soena` acaba de corregirse (PR #386: contaba la tarifa
-- UPME como recaudo propio). Meterle una dimension mas seria tocar la funcion que
-- alimenta las cuatro graficas por defecto. Esta va aparte y es **aditiva**: si falla,
-- el historico sigue dibujandose como hoy, sin filtro.
--
-- ── Las dos fechas no son la misma, y aqui tampoco ──────────────────────────────
--
-- Igual que en la serie total: una VENTA cae en el mes de su primer cobro con fecha, y
-- el RECAUDO cae en el mes en que entro la plata. Un pago de agosto puede abonar a una
-- venta de junio. Por eso las dos mitades se agrupan por su propio mes y se cruzan por
-- (mes, seccional) al final — no se fuerzan a un solo criterio.
--
-- ── Medido contra produccion el 2026-08-26, workspace SOENA ─────────────────────
--
--   215 ventas historicas en 9 meses, repartidas en 15 seccionales -> 44 filas
--   (mes, seccional). Solo **5 ventas sin seccional**; el backfill desde la casilla 12
--   del RUT cerro el hueco (venia de 22). 272 cobros con fecha, **cero sin negocio**,
--   asi que ningun peso se queda sin seccional por orfandad.
--
-- El bucket `seccional = NULL` va VISIBLE y aparte, nunca repartido a prorrata entre
-- las demas: es la misma regla que cerro Mauricio el 2026-08-22 para el corte del mes.
--
-- ── La canonizacion NO se hace aqui ─────────────────────────────────────────────
--
-- Se devuelve el texto CRUDO de `negocios.metadata.seccional` y quien consume canoniza
-- con `canonizarSeccional` (`src/lib/dian/seccionales.ts`), igual que
-- `get_comercial_seccional_mes_soena` y `getProcesoPorSeccional`. Copiar el catalogo a
-- SQL crearia una segunda fuente que se desincroniza el dia que la DIAN cambie una.
--
-- Se devuelven ademas los `negocio_ids` y los `cobro_ids` de cada fila, para que el
-- drill abra EXACTAMENTE el conjunto que produjo el numero y no una consulta paralela
-- que podria discrepar. Es el contrato que ya usan `p_negocio_ids` en
-- `get_comercial_ventas_mes_soena` y el corte del mes.
--
-- Sin DML: no se modifica ni una fila.

create or replace function public.get_comercial_serie_seccional_soena(
  p_workspace_id uuid,
  p_meses integer default 12
) returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  desde AS (
    SELECT date_trunc('month', current_date) - make_interval(months => GREATEST(p_meses, 1) - 1) AS ini
  ),
  -- Una venta cae en el mes de su primer cobro con fecha. La seccional es la del
  -- negocio, cruda; NULL es "sin registrar" y se conserva como grupo propio.
  ventas AS (
    SELECT
      n.id AS negocio_id,
      nullif(btrim(n.metadata ->> 'seccional'), '') AS seccional,
      MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') AS fecha_venta,
      COALESCE(vv.valor_aprobado_base, 0)  AS honorario_sin_iva,
      COALESCE(vv.valor_aprobado_total, 0) AS honorario_con_iva
    FROM negocios n
    JOIN guard g            ON n.workspace_id = g.id
    JOIN cobros c           ON c.negocio_id = n.id AND c.workspace_id = g.id AND c.fecha IS NOT NULL
    JOIN v_negocio_valor vv ON vv.negocio_id = n.id
    GROUP BY n.id, n.metadata, vv.valor_aprobado_base, vv.valor_aprobado_total
    HAVING MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') IS NOT NULL
  ),
  ventas_agr AS (
    SELECT
      date_trunc('month', v.fecha_venta) AS mes_ini,
      v.seccional,
      COUNT(*)                    AS num_ventas,
      SUM(v.honorario_sin_iva)    AS valor_sin_iva,
      SUM(v.honorario_con_iva)    AS valor_con_iva,
      array_agg(v.negocio_id)     AS negocio_ids
    FROM ventas v, desde d
    WHERE v.fecha_venta >= d.ini
    GROUP BY 1, 2
  ),
  -- Cada peso a su franja (tramo 1 / tarifa / tramo 2), la misma imputacion que usan
  -- el KPI del mes y la serie total desde el PR #386.
  recaudo_agr AS (
    SELECT
      date_trunc('month', cv.fecha) AS mes_ini,
      nullif(btrim(n.metadata ->> 'seccional'), '') AS seccional,
      SUM(cv.a_tramo1 + cv.a_tramo2) AS honorario_recaudado,
      SUM(cv.a_tramo1)               AS primer_pago,
      SUM(cv.a_tramo2)               AS segundo_pago,
      SUM(cv.a_tarifa)               AS tarifa,
      array_agg(cv.cobro_id)         AS cobro_ids
    FROM v_cobro_valor cv
    JOIN guard g ON cv.workspace_id = g.id
    CROSS JOIN desde d
    LEFT JOIN negocios n ON n.id = cv.negocio_id
    WHERE cv.fecha IS NOT NULL AND cv.fecha >= d.ini
    GROUP BY 1, 2
  ),
  -- Las dos mitades no comparten claves: un mes puede tener recaudo de una seccional
  -- que no vendio nada ese mes, y al reves. La union evita perder cualquiera de las dos.
  claves AS (
    SELECT mes_ini, seccional FROM ventas_agr
    UNION
    SELECT mes_ini, seccional FROM recaudo_agr
  )
  SELECT jsonb_build_object(
    'serie', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'anio',                EXTRACT(YEAR  FROM k.mes_ini)::int,
        'mes',                 EXTRACT(MONTH FROM k.mes_ini)::int,
        'seccional_cruda',     k.seccional,
        'num_ventas',          COALESCE(va.num_ventas, 0),
        'valor_sin_iva',       COALESCE(va.valor_sin_iva, 0),
        'valor_con_iva',       COALESCE(va.valor_con_iva, 0),
        'honorario_recaudado', COALESCE(ra.honorario_recaudado, 0),
        'primer_pago',         COALESCE(ra.primer_pago, 0),
        'segundo_pago',        COALESCE(ra.segundo_pago, 0),
        'tarifa_recaudada',    COALESCE(ra.tarifa, 0),
        'negocio_ids',         COALESCE(to_jsonb(va.negocio_ids), '[]'::jsonb),
        'cobro_ids',           COALESCE(to_jsonb(ra.cobro_ids), '[]'::jsonb)
      ) ORDER BY k.mes_ini, k.seccional NULLS LAST)
      FROM claves k
      LEFT JOIN ventas_agr  va ON va.mes_ini = k.mes_ini AND va.seccional IS NOT DISTINCT FROM k.seccional
      LEFT JOIN recaudo_agr ra ON ra.mes_ini = k.mes_ini AND ra.seccional IS NOT DISTINCT FROM k.seccional
    ), '[]'::jsonb)
  );
$function$;

comment on function public.get_comercial_serie_seccional_soena(uuid, integer) is
  'Historico mensual abierto por seccional DIAN, para filtrar las cuatro graficas del '
  'tablero comercial. Misma imputacion por franja que la serie total (v_cobro_valor). '
  'Devuelve la seccional CRUDA — el catalogo canonico vive en TypeScript — y los '
  'negocio_ids / cobro_ids que suman cada fila, para que el drill abra el conjunto exacto.';

revoke execute on function public.get_comercial_serie_seccional_soena(uuid, integer) from public, anon;
grant  execute on function public.get_comercial_serie_seccional_soena(uuid, integer) to authenticated;
