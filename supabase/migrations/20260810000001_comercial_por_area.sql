-- Los indicadores comerciales se atribuyen al COMERCIAL del negocio, no a su
-- "responsable principal".
--
-- `negocios.responsable_id` es el responsable principal DERIVADO (el asignado mas
-- antiguo), no el comercial. Desde que el negocio admite dos responsables con rol
-- (`comercial` y `operaciones`), ese campo puede apuntar a un operativo, y las tres
-- RPC comerciales agrupaban por el sin mirar el area. Resultado: gente de operaciones
-- figurando en el tablero comercial.
--
-- Medido en SOENA antes de escribir esto: Maria Camila Garzon (9 negocios), Jhon Fredy
-- Rios (5) y Juan Jose Ibanez (2) aparecian como comerciales. Y no era solo ruido
-- visual: de esos 16 negocios, 9 SI tenian comercial asignado (Daniela), asi que su
-- trabajo estaba atribuido a la persona equivocada. Filtrarlos habria escondido esos 9;
-- reatribuirlos es lo que corrige la cifra.
--
-- El criterio vive en UNA vista y las tres RPC la consumen. Es la leccion de la formula
-- de saldo que termino escrita en siete sitios con tres tolerancias distintas.

-- Quien es el comercial de cada negocio.
--
-- 1) El responsable con rol `comercial` (indice unico por negocio, asi que es uno solo).
-- 2) Si no hay, el responsable principal SIEMPRE QUE NO SEA DE OPERACIONES. Sin esta
--    salvedad, un negocio sin comercial devuelve al operativo al tablero comercial, que
--    es justo lo que se esta corrigiendo. Con ella, quien no tiene area declarada (el
--    dueno, que toma casos especiales) conserva su atribucion.
-- 3) Si ninguna aplica, NULL: el negocio no tiene comercial y eso se muestra como tal,
--    en vez de repartirlo entre quienes si trabajaron.
create or replace view v_negocio_comercial as
  select
    n.id                                                   as negocio_id,
    n.workspace_id,
    coalesce(
      nrc.staff_id,
      case when sa_op.staff_id is null then n.responsable_id end
    )                                                      as comercial_staff_id
  from negocios n
  left join negocio_responsables nrc
         on nrc.negocio_id = n.id and nrc.rol = 'comercial'
  left join staff_areas sa_op
         on sa_op.staff_id = n.responsable_id and sa_op.area = 'operaciones';

comment on view v_negocio_comercial is
  'Fuente unica de a que comercial se le atribuye un negocio. La consumen las RPC comerciales; no se expone al cliente.';

-- Solo la consumen funciones SECURITY DEFINER. Sin grant no es alcanzable por PostgREST
-- con la anon key, que es la convencion del proyecto para lo que no debe salir al browser.
revoke all on v_negocio_comercial from anon, authenticated;

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
      COALESCE(n.precio_aprobado, 0)      AS precio_aprobado,
      cn.fecha_venta,
      (cn.fecha_venta IS NOT NULL
        AND (p_anio IS NULL
             OR (EXTRACT(YEAR FROM cn.fecha_venta) = p_anio AND EXTRACT(MONTH FROM cn.fecha_venta) = p_mes)))
                                          AS es_venta_periodo,
      COALESCE(cn.honorario, 0)           AS honorario_recaudado,
      COALESCE(cn.tarifa, 0)              AS tarifa_recaudada
    FROM negocios n
    CROSS JOIN guard g
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
      COALESCE(SUM(b.precio_aprobado), 0)                          AS valor_aprobado,
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
           'responsable_id',       pr.responsable_id,
           'nombre',               COALESCE(s.full_name, '(sin responsable)'),
           'position',             s.position,
           'es_lider',             COALESCE(pf.role IN ('owner','admin','supervisor'), false),
           'sin_responsable',      pr.responsable_id IS NULL,
           'negocios_total',       pr.negocios_total,
           'negocios_abiertos',    pr.negocios_abiertos,
           'num_ventas',           pr.num_ventas,
           'en_venta',             pr.en_venta,
           'en_ejecucion',         pr.en_ejecucion,
           'en_cobro',             pr.en_cobro,
           'cerrados',             pr.cerrados,
           'valor_aprobado',       pr.valor_aprobado,
           'honorario_recaudado',  pr.honorario_recaudado,
           'tarifa_recaudada',     pr.tarifa_recaudada
         ) AS x,
         pr.num_ventas AS val,
         COALESCE(s.full_name, '(sin responsable)') AS nombre
       FROM por_resp pr
       LEFT JOIN staff s    ON s.id = pr.responsable_id
       LEFT JOIN profiles pf ON pf.id = s.profile_id
     ) t),
    '[]'::jsonb
  );
$function$


CREATE OR REPLACE FUNCTION public.get_comercial_perfil_soena(p_responsable_id uuid, p_anio integer DEFAULT NULL::integer, p_mes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      COALESCE(n.precio_aprobado, 0)  AS precio_aprobado,
      cn.fecha_venta,
      (cn.fecha_venta IS NOT NULL
        AND (p_anio IS NULL
             OR (EXTRACT(YEAR FROM cn.fecha_venta) = p_anio AND EXTRACT(MONTH FROM cn.fecha_venta) = p_mes)))
                                      AS es_venta_periodo,
      COALESCE(cn.honorario, 0)       AS honorario_recaudado,
      COALESCE(cn.tarifa, 0)          AS tarifa_recaudada,
      GREATEST(COALESCE(n.precio_aprobado,0) - COALESCE(cn.honorario,0), 0) AS pendiente_honorario,
      CASE
        WHEN n.estado <> 'abierto' THEN 'sin_sla'
        WHEN (e.config_extra->>'sla_horas') IS NULL THEN 'sin_sla'
        WHEN horas_habiles_entre(n.etapa_cambiada_at, now()) > (e.config_extra->>'sla_horas')::numeric THEN 'vencido'
        ELSE 'a_tiempo'
      END AS sla_estado
    FROM negocios n
    CROSS JOIN ws
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
           COALESCE(SUM(precio_aprobado),0) AS valor
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
        'negocios_total',      COUNT(*),
        'negocios_abiertos',   COUNT(*) FILTER (WHERE estado = 'abierto'),
        'num_ventas',          COUNT(*) FILTER (WHERE es_venta_periodo),
        'valor_aprobado',      COALESCE(SUM(precio_aprobado), 0),
        'honorario_recaudado', COALESCE(SUM(honorario_recaudado), 0),
        'tarifa_recaudada',    COALESCE(SUM(tarifa_recaudada), 0),
        'pendiente_honorario', COALESCE(SUM(pendiente_honorario), 0),
        'vencidos',            COUNT(*) FILTER (WHERE sla_estado = 'vencido')
      ) FROM base
    ),
    'porStage', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'stage', stage, 'negocios', cnt, 'valor_aprobado', val, 'pendiente_honorario', pend
      ) ORDER BY ord)
      FROM (
        SELECT COALESCE(stage_actual, '(sin stage)') AS stage, COUNT(*) AS cnt,
          COALESCE(SUM(precio_aprobado), 0) AS val, COALESCE(SUM(pendiente_honorario), 0) AS pend,
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
          COALESCE(SUM(precio_aprobado),0) val, COALESCE(SUM(pendiente_honorario),0) pend
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
        'valor_aprobado', precio_aprobado, 'honorario_recaudado', honorario_recaudado,
        'tarifa_recaudada', tarifa_recaudada, 'pendiente_honorario', pendiente_honorario
      ) ORDER BY precio_aprobado DESC, nombre)
      FROM base
    ), '[]'::jsonb)
  );
$function$


CREATE OR REPLACE FUNCTION public.get_comercial_kpis_mes_soena(p_workspace_id uuid, p_anio integer, p_mes integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  propuesta AS (
    SELECT DISTINCT ON (nb.negocio_id)
      nb.negocio_id,
      (nb.data->>'aprobado_honorario')::numeric AS honorario_con_iva,
      CASE
        WHEN COALESCE(NULLIF(nb.data->>'iva_pct','')::numeric, 0.19) > 1
          THEN COALESCE(NULLIF(nb.data->>'iva_pct','')::numeric, 0.19) / 100
        ELSE COALESCE(NULLIF(nb.data->>'iva_pct','')::numeric, 0.19)
      END AS iva_frac
    FROM negocio_bloques nb
    JOIN negocios n            ON n.id = nb.negocio_id
    JOIN guard g               ON n.workspace_id = g.id
    JOIN bloque_configs bc     ON bc.id = nb.bloque_config_id
    JOIN bloque_definitions bd ON bd.id = bc.bloque_definition_id
    WHERE bd.tipo = 'propuesta_economica' AND (nb.data->>'aprobado_at') IS NOT NULL
    ORDER BY nb.negocio_id, (nb.data->>'aprobado_at')::timestamptz DESC
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
      COALESCE(p.honorario_con_iva, n.precio_aprobado, 0)                       AS honorario_con_iva,
      COALESCE(p.honorario_con_iva / (1 + p.iva_frac),
               n.precio_aprobado / 1.19, 0)                                     AS honorario_sin_iva,
      COALESCE(cn.honorario_recaudado, 0)                                       AS honorario_recaudado,
      COALESCE(cn.primer_pago, 0)                                               AS primer_pago,
      COALESCE(cn.segundo_pago, 0)                                              AS segundo_pago,
      COALESCE(cn.tarifa, 0)                                                    AS tarifa,
      (COALESCE(cn.honorario_recaudado, 0)
        >= COALESCE(p.honorario_con_iva / (1 + p.iva_frac), n.precio_aprobado / 1.19, 0) - 1) AS caso_completo
    FROM negocios n
    JOIN guard g          ON n.workspace_id = g.id
    JOIN cobros_neg cn    ON cn.negocio_id = n.id AND cn.fecha_venta IS NOT NULL
    LEFT JOIN propuesta p ON p.negocio_id = n.id
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
      'tasa_recaudo',         CASE WHEN (SELECT valor_sin_iva FROM tot) > 0
                                    THEN round(100.0 * (SELECT honorario_recaudado FROM tot) / (SELECT valor_sin_iva FROM tot), 1)
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
$function$
