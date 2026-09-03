-- Las series del tablero comercial cuentan las ventas como las cuenta la tarjeta
--
-- Defecto introducido por 20260903120000 (PR #515). Esa migracion abrio una segunda
-- puerta en `v_venta_mes_comercial` para el negocio en cero (convenio ejecutado sin
-- cobro), pero tres RPC de serie nunca leyeron la vista: cada una repite en su CTE
-- `ventas` la definicion vieja, "negocio con al menos un cobro no pasante". Resultado
-- visible hoy en el tablero de SOENA: la tarjeta de KPI de julio dice 47 ventas y la
-- grafica de la misma pantalla dice 45. Agosto dice 63 y 62.
--
-- Antes de #515 las dos definiciones coincidian, asi que la duplicacion no dolia. Lo
-- que sigue la elimina: las tres pasan a leer la vista, que es donde vive la regla.
--
-- ── Por que es un reemplazo y no una reescritura ──
--
-- `v_cobro_valor` ya filtra `fecha IS NOT NULL` y `tipo_cobro <> 'pasante'`, que son
-- exactamente los dos filtros que hacia a mano el CTE viejo, y `cobros_neg` toma
-- `min(cv.fecha)` sobre esa vista. La `fecha_venta` de la vista es entonces el mismo
-- numero que calculaba el HAVING. Igual con el valor: ambas partes salen de
-- `v_negocio_valor`, y `responsable_id` de la vista ES `v_negocio_comercial
-- .comercial_staff_id`, que es lo que la serie por vendedor ya usaba.
--
-- El unico delta es el que se quiso: entran los negocios en cero.
--
-- ── Medido contra produccion (SOENA) antes de escribir ──
--
--   mes      viejo -> nuevo    valor con IVA
--   2025-12    3 -> 3          2.240.000 (igual)
--   2026-01    2 -> 2          1.062.500 (igual)
--   2026-02   13 -> 13         9.035.321,50 (igual)
--   2026-03   39 -> 39        25.776.250 (igual)
--   2026-04   39 -> 39        24.782.498,50 (igual)
--   2026-05   80 -> 80        52.587.500 (igual)
--   2026-06   21 -> 21        12.196.750 (igual)
--   2026-07   45 -> 47        27.204.750 (igual)  + V0022, V0066
--   2026-08   62 -> 63        36.412.466 (igual)  + V0429
--   2026-09    3 -> 3          1.870.000 (igual)
--
--   negocios que desaparecen: 0
--   negocios que cambian de `fecha_venta`: 0
--   valor que se mueve: 0 pesos (los tres casos valen cero, por eso solo mueven conteo)
--
-- Donde caen los tres en las series desagregadas:
--   V0022 BIOCIRCULO           06-jul  seccional NULL     Juan Bruce
--   V0066 EDWIN GARCIA         15-jul  seccional Bogota   Jessica Tejada
--   V0429 ANGELA RODRIGUEZ     26-ago  seccional Bogota   Jessica Tejada
--
-- ⚠️ Los bloques de RECAUDO no se tocan en ninguna de las tres. Siguen leyendo
-- `v_cobro_valor` por `fecha` de cobro, y deben seguir asi: la serie mezcla a
-- proposito un corte de cohorte (ventas, por `fecha_venta`) con un corte de caja
-- (recaudo, por fecha del pago). Un negocio en cero no tiene cobro y por tanto no
-- suma un peso de recaudo, que es justo lo correcto.

-- ── 1. Serie mensual ──

CREATE OR REPLACE FUNCTION public.get_comercial_serie_mensual_soena(p_workspace_id uuid, p_meses integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  meses AS (
    SELECT date_trunc('month', CURRENT_DATE) - (n || ' month')::interval AS mes_ini
    FROM generate_series(0, GREATEST(p_meses,1) - 1) n
  ),
  ventas AS (
    SELECT v.fecha_venta, v.honorario_sin_iva, v.honorario_con_iva
    FROM v_venta_mes_comercial v
    JOIN guard g ON v.workspace_id = g.id
    WHERE v.fecha_venta IS NOT NULL
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
      date_trunc('month', cv.fecha) AS mes_ini,
      SUM(cv.a_tramo1_base + cv.a_tramo2_base) AS honorario_recaudado,
      SUM(cv.a_tramo1_base)                    AS primer_pago,
      SUM(cv.a_tramo2_base)                    AS segundo_pago,
      SUM(cv.a_tarifa)                         AS tarifa
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
    'tasa_recaudo_global', (
      SELECT CASE WHEN SUM(vm.valor_sin_iva) > 0
                  THEN round(100.0 * COALESCE((SELECT SUM(honorario_recaudado) FROM recaudo_por_mes), 0)
                       / SUM(vm.valor_sin_iva), 1)
                  ELSE NULL END
      FROM ventas_por_mes vm
    )
  );
$function$;

-- ── 2. Serie por seccional ──
-- La seccional no vive en la vista: es `negocios.metadata->>'seccional'`, un campo
-- crudo que el equipo de SOENA escribe a mano. Por eso aqui si hay JOIN a `negocios`,
-- y por eso el JSON la expone como `seccional_cruda`: la normalizacion la hace la
-- pantalla, no la base.

CREATE OR REPLACE FUNCTION public.get_comercial_serie_seccional_soena(p_workspace_id uuid, p_meses integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  desde AS (
    SELECT date_trunc('month', current_date) - make_interval(months => GREATEST(p_meses, 1) - 1) AS ini
  ),
  ventas AS (
    SELECT
      v.negocio_id,
      nullif(btrim(n.metadata ->> 'seccional'), '') AS seccional,
      v.fecha_venta,
      v.honorario_sin_iva,
      v.honorario_con_iva
    FROM v_venta_mes_comercial v
    JOIN guard g    ON v.workspace_id = g.id
    JOIN negocios n ON n.id = v.negocio_id
    WHERE v.fecha_venta IS NOT NULL
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
  recaudo_agr AS (
    SELECT
      date_trunc('month', cv.fecha) AS mes_ini,
      nullif(btrim(n.metadata ->> 'seccional'), '') AS seccional,
      SUM(cv.a_tramo1_base + cv.a_tramo2_base) AS honorario_recaudado,
      SUM(cv.a_tramo1_base)                    AS primer_pago,
      SUM(cv.a_tramo2_base)                    AS segundo_pago,
      SUM(cv.a_tarifa)                         AS tarifa,
      array_agg(cv.cobro_id)                   AS cobro_ids
    FROM v_cobro_valor cv
    JOIN guard g ON cv.workspace_id = g.id
    CROSS JOIN desde d
    LEFT JOIN negocios n ON n.id = cv.negocio_id
    WHERE cv.fecha IS NOT NULL AND cv.fecha >= d.ini
    GROUP BY 1, 2
  ),
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

-- ── 3. Serie por vendedor ──
-- `v_venta_mes_comercial.responsable_id` ya ES el comercial resuelto por
-- `v_negocio_comercial`, asi que el LEFT JOIN que hacia esta funcion sobra. El bloque
-- de recaudo si lo conserva, porque va por cobro y no por negocio vendido.

CREATE OR REPLACE FUNCTION public.get_comercial_serie_vendedor_soena(p_workspace_id uuid, p_meses integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  desde AS (
    SELECT date_trunc('month', current_date) - make_interval(months => GREATEST(p_meses, 1) - 1) AS ini
  ),
  ventas AS (
    SELECT
      v.negocio_id,
      v.responsable_id,
      v.fecha_venta,
      v.honorario_sin_iva,
      v.honorario_con_iva
    FROM v_venta_mes_comercial v
    JOIN guard g ON v.workspace_id = g.id
    WHERE v.fecha_venta IS NOT NULL
  ),
  ventas_agr AS (
    SELECT
      date_trunc('month', v.fecha_venta) AS mes_ini,
      v.responsable_id,
      COUNT(*)                    AS num_ventas,
      SUM(v.honorario_sin_iva)    AS valor_sin_iva,
      SUM(v.honorario_con_iva)    AS valor_con_iva,
      array_agg(v.negocio_id)     AS negocio_ids
    FROM ventas v, desde d
    WHERE v.fecha_venta >= d.ini
    GROUP BY 1, 2
  ),
  recaudo_agr AS (
    SELECT
      date_trunc('month', cv.fecha) AS mes_ini,
      vc.comercial_staff_id AS responsable_id,
      SUM(cv.a_tramo1_base + cv.a_tramo2_base) AS honorario_recaudado,
      SUM(cv.a_tramo1_base)                    AS primer_pago,
      SUM(cv.a_tramo2_base)                    AS segundo_pago,
      SUM(cv.a_tarifa)                         AS tarifa,
      array_agg(cv.cobro_id)                   AS cobro_ids
    FROM v_cobro_valor cv
    JOIN guard g ON cv.workspace_id = g.id
    CROSS JOIN desde d
    LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = cv.negocio_id
    WHERE cv.fecha IS NOT NULL AND cv.fecha >= d.ini
    GROUP BY 1, 2
  ),
  claves AS (
    SELECT mes_ini, responsable_id FROM ventas_agr
    UNION
    SELECT mes_ini, responsable_id FROM recaudo_agr
  )
  SELECT jsonb_build_object(
    'serie', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'anio',                EXTRACT(YEAR  FROM k.mes_ini)::int,
        'mes',                 EXTRACT(MONTH FROM k.mes_ini)::int,
        'responsable_id',      k.responsable_id,
        'nombre',              COALESCE(s.full_name, '(sin responsable)'),
        'num_ventas',          COALESCE(va.num_ventas, 0),
        'valor_sin_iva',       COALESCE(va.valor_sin_iva, 0),
        'valor_con_iva',       COALESCE(va.valor_con_iva, 0),
        'honorario_recaudado', COALESCE(ra.honorario_recaudado, 0),
        'primer_pago',         COALESCE(ra.primer_pago, 0),
        'segundo_pago',        COALESCE(ra.segundo_pago, 0),
        'tarifa_recaudada',    COALESCE(ra.tarifa, 0),
        'negocio_ids',         COALESCE(to_jsonb(va.negocio_ids), '[]'::jsonb),
        'cobro_ids',           COALESCE(to_jsonb(ra.cobro_ids), '[]'::jsonb)
      ) ORDER BY k.mes_ini, k.responsable_id NULLS LAST)
      FROM claves k
      LEFT JOIN ventas_agr  va ON va.mes_ini = k.mes_ini AND va.responsable_id IS NOT DISTINCT FROM k.responsable_id
      LEFT JOIN recaudo_agr ra ON ra.mes_ini = k.mes_ini AND ra.responsable_id IS NOT DISTINCT FROM k.responsable_id
      LEFT JOIN staff s ON s.id = k.responsable_id
    ), '[]'::jsonb)
  );
$function$;
