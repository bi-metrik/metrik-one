-- La hoja por persona de /equipo cuenta las ventas como las cuenta el panel, y su
-- "pendiente de recaudo" deja de moverse con el mes.
--
-- ⚠️ SIN APLICAR al abrir el PR. Va ANTES del merge del codigo que la acompana (aunque
-- ese codigo no rompe si llega primero: solo cambia rotulos), y su version se comprueba
-- contra `supabase_migrations.schema_migrations` antes de aplicarla.
--
-- ⚠️ Escrita sobre el archivo `20260902220053`, NO sobre `pg_get_functiondef` de
-- produccion (la sesion que la escribio no tuvo acceso a SQL). Lo que si se comprobo es
-- que las dos funciones VIVAS se comportan como ese archivo: reproduciendo su calculo
-- sobre los datos de produccion salen al peso las cifras que el QA leyo en pantalla el
-- 2026-09-14 (Jessica: ventas ago 31, jul 33, acumulado 201; pendiente sep $105.585.123,
-- ago $96.153.295, jul $92.918.495; aprobado $110.559.248; Esperanza marzo = aprobado).
-- Antes de aplicar, conviene igual volcar las dos definiciones vivas y compararlas.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Defecto 1 — dos definiciones de venta en la misma pantalla
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `20260903120000` abrio una segunda puerta en `v_venta_mes_comercial` para el negocio
-- en cero (convenio ejecutado sin cobro; decision de Mauricio del 2026-09-03: cuenta
-- como cierre, no paga bono ni comision). `20260903140000` paso las tres series a leer
-- la vista. Estas dos RPC quedaron con la definicion vieja: `MIN(v_cobro_valor.fecha)`,
-- o sea "negocio con al menos un cobro". Resultado en la hoja de Jessica:
--
--   agosto:  KPI 31 / panel 32   (falta V0429, venta 26-ago, $0, sin cobros)
--   julio:   KPI 33 / panel 34   (falta V0066, venta 15-jul, $0, sin cobros)
--
-- y la tarjeta "Numero de ventas" del leaderboard, que sale del resumen y abre el MISMO
-- panel, arrastraba el mismo desfase.
--
-- Arreglo: la venta y su fecha salen de la vista canonica, la misma que consume el
-- panel (`get_comercial_ventas_mes_soena`). La atribucion ya era la misma en las dos
-- (`v_negocio_comercial.comercial_staff_id` ES `v_venta_mes_comercial.responsable_id`),
-- asi que el KPI y la lista coinciden por construccion, no por casualidad.
--
-- `bonificable` tambien sale de la vista en el resumen: ahi las ventas en cero van en
-- FALSE. Leerlo de `v_negocio_bonificable`, como hacia, las habria contado como
-- bonificables en el ranking (#31) en cuanto entraran al conteo.
--
-- Medido contra produccion (SOENA) antes de escribir, por persona:
--
--   periodo     total viejo -> nuevo   quien cambia
--   2026-07        45 -> 47            Jessica 33 -> 34 (V0066), Juan Bruce 0 -> 1 (V0022)
--   2026-08        62 -> 63            Jessica 31 -> 32 (V0429)
--   2026-09        23 -> 23            nadie
--   acumulado     327 -> 330           Jessica 201 -> 203, Juan Bruce 15 -> 16
--
--   negocios que dejan de contar: 0. Fechas de venta que cambian: 0.
--   Los tres que entran valen cero y no tienen un solo cobro: no mueven valor ni recaudo.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Defecto 2 — "Pendiente de recaudo" mezclaba dos relojes
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La tarjeta dice "Inventario a hoy, no depende del mes" y calculaba
-- `valor aprobado (de todo el inventario) - honorario recaudado DEL MES elegido`.
-- Por eso cambiaba con el mes, y un mes sin recaudo mostraba el aprobado completo como
-- si nadie hubiera pagado nunca. La columna del embudo por etapa, igual.
--
-- Arreglo: es inventario a hoy de verdad. Por negocio ABIERTO,
-- `valor aprobado sin IVA - TODO el honorario recaudado sin IVA`, sin importar el mes.
-- Los cerrados (completado, perdido, cancelado) aportan cero: un caso perdido no es
-- plata por recaudar. Medido: el unico cerrado de SOENA con saldo es V0299 (perdido,
-- $535.714 aprobados, nunca pago), que la formula vieja le sumaba a Esperanza.
--
-- El honorario recaudado DEL PERIODO se conserva tal cual para el KPI "Honorario
-- recaudado" y la columna "Honorario" de la tabla, que si dependen del mes. Son dos
-- sumas distintas del mismo `v_cobro_valor`, a proposito.
--
-- Va SIN IVA, las dos partes en base, igual que el resto de la hoja (valor aprobado sin
-- IVA, honorario neto de IVA). La pantalla dejo de rotularlo "con IVA".
--
--   Jessica, pendiente a hoy: $9.309.846 para septiembre, agosto, julio y marzo.
--   (Antes: $105.585.123 / $96.153.295 / $92.918.495 / $101.148.534.)
--   Esperanza: $472 (antes, en marzo, $12.859.820).

-- ── 1. Resumen por comercial ──

CREATE OR REPLACE FUNCTION public.get_comercial_resumen_soena(p_workspace_id uuid, p_anio integer DEFAULT NULL::integer, p_mes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  -- Recaudo del periodo YA IMPUTADO. `v_cobro_valor` separa lo que es honorario
  -- (tramo 1 + tramo 2) de lo que es tarifa de un tercero. Sumar `cobros.monto` a
  -- secas metia la tarifa dentro del honorario del comercial.
  -- El honorario va NETO de IVA (columnas _base); la tarifa va integra porque la
  -- tarifa UPME no causa IVA.
  cobros_neg AS (
    SELECT
      cv.negocio_id,
      SUM(cv.a_tramo1_base + cv.a_tramo2_base) FILTER (
        WHERE (p_anio IS NULL OR (EXTRACT(YEAR FROM cv.fecha) = p_anio AND EXTRACT(MONTH FROM cv.fecha) = p_mes))
      )                                                                AS honorario,
      SUM(cv.a_tarifa) FILTER (
        WHERE (p_anio IS NULL OR (EXTRACT(YEAR FROM cv.fecha) = p_anio AND EXTRACT(MONTH FROM cv.fecha) = p_mes))
      )                                                                AS tarifa
    FROM v_cobro_valor cv, guard g
    WHERE cv.workspace_id = g.id AND cv.fecha IS NOT NULL
    GROUP BY cv.negocio_id
  ),
  -- La venta sale de la vista canonica: la misma que abre el panel de casos. Incluye
  -- la venta en cero (sin cobro), que el `MIN(cv.fecha)` de antes dejaba afuera.
  ventas AS (
    SELECT v.negocio_id, v.fecha_venta, v.bonificable
    FROM v_venta_mes_comercial v, guard g
    WHERE v.workspace_id = g.id
  ),
  base AS (
    SELECT
      vc.comercial_staff_id AS responsable_id,
      n.stage_actual,
      n.estado,
      COALESCE(vv.valor_aprobado_base, 0)  AS valor_sin_iva,
      COALESCE(vv.valor_aprobado_total, 0) AS valor_con_iva,
      vt.fecha_venta,
      (vt.fecha_venta IS NOT NULL
        AND (p_anio IS NULL
             OR (EXTRACT(YEAR FROM vt.fecha_venta) = p_anio AND EXTRACT(MONTH FROM vt.fecha_venta) = p_mes)))
                                          AS es_venta_periodo,
      -- De la vista y no de `v_negocio_bonificable`: la venta en cero sale en FALSE
      -- (cuenta como cierre, no paga bono).
      vt.bonificable,
      COALESCE(cn.honorario, 0)           AS honorario_recaudado,
      COALESCE(cn.tarifa, 0)              AS tarifa_recaudada
    FROM negocios n
    CROSS JOIN guard g
    JOIN v_negocio_valor vv ON vv.negocio_id = n.id
    LEFT JOIN cobros_neg cn ON cn.negocio_id = n.id
    LEFT JOIN ventas vt ON vt.negocio_id = n.id
    LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = n.id
    WHERE n.workspace_id = g.id
  ),
  por_resp AS (
    SELECT
      b.responsable_id,
      COUNT(*)                                                      AS negocios_total,
      COUNT(*) FILTER (WHERE b.estado = 'abierto')                 AS negocios_abiertos,
      COUNT(*) FILTER (WHERE b.es_venta_periodo)                   AS num_ventas,
      -- Ventas del periodo que ademas pasaron el umbral. NULL cuando ninguna de sus
      -- ventas se pudo medir: sin dato no es cero, y un cero aqui borraria a esa
      -- persona del ranking.
      CASE WHEN COUNT(*) FILTER (WHERE b.es_venta_periodo) = 0 THEN 0
           WHEN COUNT(*) FILTER (WHERE b.es_venta_periodo AND b.bonificable IS NULL)
                = COUNT(*) FILTER (WHERE b.es_venta_periodo) THEN NULL
           ELSE COUNT(*) FILTER (WHERE b.es_venta_periodo AND b.bonificable)
      END                                                           AS num_bonificables,
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
           'num_bonificables',      pr.num_bonificables,
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

-- ── 2. Perfil de un comercial ──

CREATE OR REPLACE FUNCTION public.get_comercial_perfil_soena(p_responsable_id uuid, p_anio integer DEFAULT NULL::integer, p_mes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ws AS (SELECT current_user_workspace_id() AS id),
  -- Dos relojes, separados a proposito y con nombre propio:
  --   `honorario`/`tarifa`  -> lo recaudado EN el periodo (KPI y tabla, se mueven con el mes)
  --   `honorario_total`     -> todo lo recaudado a hoy (pendiente, NO se mueve con el mes)
  cobros_neg AS (
    SELECT
      cv.negocio_id,
      SUM(cv.a_tramo1_base + cv.a_tramo2_base) FILTER (
        WHERE (p_anio IS NULL OR (EXTRACT(YEAR FROM cv.fecha) = p_anio AND EXTRACT(MONTH FROM cv.fecha) = p_mes))
      ) AS honorario,
      SUM(cv.a_tarifa) FILTER (
        WHERE (p_anio IS NULL OR (EXTRACT(YEAR FROM cv.fecha) = p_anio AND EXTRACT(MONTH FROM cv.fecha) = p_mes))
      ) AS tarifa,
      SUM(cv.a_tramo1_base + cv.a_tramo2_base) AS honorario_total
    FROM v_cobro_valor cv, ws
    WHERE cv.workspace_id = ws.id AND cv.fecha IS NOT NULL
    GROUP BY cv.negocio_id
  ),
  -- La venta sale de la vista canonica, la misma que abre el panel de casos.
  ventas AS (
    SELECT v.negocio_id, v.fecha_venta
    FROM v_venta_mes_comercial v, ws
    WHERE v.workspace_id = ws.id
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
      -- Venta e ingreso van SIN IVA. `valor_con_iva` se conserva como cifra de
      -- CARTERA (lo que el cliente paga), no como cifra de ingreso.
      COALESCE(vv.valor_aprobado_base, 0)  AS valor_sin_iva,
      COALESCE(vv.valor_aprobado_total, 0) AS valor_con_iva,
      vt.fecha_venta,
      (vt.fecha_venta IS NOT NULL
        AND (p_anio IS NULL
             OR (EXTRACT(YEAR FROM vt.fecha_venta) = p_anio AND EXTRACT(MONTH FROM vt.fecha_venta) = p_mes)))
                                      AS es_venta_periodo,
      COALESCE(cn.honorario, 0)       AS honorario_recaudado,
      COALESCE(cn.tarifa, 0)          AS tarifa_recaudada,
      -- Inventario a hoy: lo que falta por recaudar de un caso ABIERTO, contra TODO lo
      -- recaudado, sin importar el mes. Los dos lados en base (sin IVA).
      CASE WHEN n.estado = 'abierto'
           THEN GREATEST(COALESCE(vv.valor_aprobado_base,0) - COALESCE(cn.honorario_total,0), 0)
           ELSE 0
      END                             AS pendiente_honorario,
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
    LEFT JOIN ventas vt        ON vt.negocio_id = n.id
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
    SELECT date_trunc('month', cv.fecha) AS mes_ini,
           SUM(cv.a_tramo1_base + cv.a_tramo2_base) AS honorario
    FROM v_cobro_valor cv
    CROSS JOIN ws
    JOIN negocios n ON n.id = cv.negocio_id
    LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = n.id
    WHERE cv.workspace_id = ws.id AND cv.fecha IS NOT NULL
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

-- ── 3. Quien puede invocarlas ──
--
-- `create or replace` NO reinicia la ACL: en produccion las dos ya estan como deben. El
-- revoke existe para una base reconstruida desde las migraciones en orden, donde toda
-- funcion nace ejecutable por PUBLIC. `authenticated` conserva EXECUTE: la aplicacion las
-- invoca con el cliente de la sesion y cada una filtra por `current_user_workspace_id()`.
revoke execute on function public.get_comercial_resumen_soena(uuid, integer, integer) from public, anon;
revoke execute on function public.get_comercial_perfil_soena(uuid, integer, integer)  from public, anon;
