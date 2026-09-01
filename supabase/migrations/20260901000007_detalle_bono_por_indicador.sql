-- El panel lateral del bono: los casos detras de cada puntaje
-- =============================================================
--
-- La tabla dice "1/43 radicaciones" y hasta ahora no habia forma de ver cuales.
-- Esta migracion no cambia ni un calculo del bono: amplia el detalle para que
-- CADA uno de los cuatro indicadores pueda abrir su lista de casos.
--
-- Dos defectos que se arreglan de paso, y que importan mas que lo que se agrega:
--
-- 1. **El detalle leia otra configuracion que el resumen.** Desde que la politica
--    se volvio mensual (`config_bono_operaciones_mes`), el resumen resuelve el mes
--    y esta funcion seguia leyendo solo el default. Un mes con horas propias
--    mostraba un porcentaje calculado con unas horas y una lista juzgada con otras:
--    quien abriera su hoja para entender por que perdio el indicador veria casos
--    marcados a tiempo dentro de un indicador incumplido. Es exactamente el defecto
--    que el encabezado de la version anterior decia estar evitando.
--
-- 2. **Faltaba el detalle de dos indicadores de los cuatro.** Envio no tenia
--    ninguno, y correcciones solo mostraba el numerador (las devoluciones). El
--    denominador que se acordo el 2026-09-01 (todo caso que PASA la etapa de envio)
--    no se podia auditar, que es justo el numero que estaba mal antes.
--
-- ⚠️ La trampa de identidad, que aqui convive en la misma funcion:
--    `negocio_bloques.completado_por` -> `profiles.id`   (radicaciones y envios)
--    `activity_log.autor_id`          -> `staff.id`      (radicaciones ante la DIAN)
--    `reproceso_eventos.atribuido_a`  -> `staff.id`      (reprocesos)
--    Cruzarlas no da error: da una lista vacia, que se lee como "no hizo nada".

CREATE OR REPLACE FUNCTION public.get_operaciones_bono_detalle(p_staff_id uuid, p_anio integer, p_mes integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH persona AS (
    SELECT s.id, s.full_name, s.position, s.profile_id, s.workspace_id
    FROM staff s
    WHERE s.id = p_staff_id
      AND s.workspace_id = current_user_workspace_id()
  ),
  -- La MISMA resolucion de configuracion que `get_operaciones_bono_resumen`: el mes
  -- manda sobre el default. Resolverla distinto en cada lado es como se producen dos
  -- verdades sobre el mismo caso.
  cfg_default AS (
    SELECT c.* FROM config_bono_operaciones c JOIN persona p ON p.workspace_id = c.workspace_id
  ),
  cfg_mes AS (
    SELECT m.* FROM config_bono_operaciones_mes m JOIN persona p ON p.workspace_id = m.workspace_id
    WHERE m.anio = p_anio AND m.mes = p_mes
  ),
  cfg AS (
    SELECT
      COALESCE(m.horas_radicacion,            d.horas_radicacion)            AS horas_radicacion,
      COALESCE(m.horas_desde_certificado,     d.horas_desde_certificado)     AS horas_desde_certificado,
      COALESCE(m.horas_antes_cita,            d.horas_antes_cita)            AS horas_antes_cita,
      COALESCE(m.radicacion_reloj,            d.radicacion_reloj)            AS radicacion_reloj,
      COALESCE(m.jornada_inicio_hora,         d.jornada_inicio_hora)         AS jornada_inicio_hora,
      COALESCE(m.jornada_fin_hora,            d.jornada_fin_hora)            AS jornada_fin_hora,
      COALESCE(m.jornada_sabado_habil,        d.jornada_sabado_habil)        AS jornada_sabado_habil,
      COALESCE(m.etapa_radicacion_dian_orden, d.etapa_radicacion_dian_orden) AS etapa_radicacion_dian_orden
    FROM cfg_default d
    LEFT JOIN cfg_mes m ON true
  ),
  periodo AS (
    SELECT
      (make_date(p_anio, p_mes, 1)::timestamp AT TIME ZONE 'America/Bogota')                        AS desde,
      ((make_date(p_anio, p_mes, 1) + interval '1 month')::timestamp AT TIME ZONE 'America/Bogota') AS hasta
  ),

  -- ---------- 1. Radicacion: el reloj desde la asignacion ----------
  casos AS (
    SELECT ne.id AS negocio_id, ne.codigo, ne.nombre, nb.completado_at AS fin,
      (SELECT MAX(nr.assigned_at) FROM negocio_responsables nr
        WHERE nr.negocio_id = nb.negocio_id AND nr.rol = 'operaciones'
          AND nr.assigned_at IS NOT NULL AND nr.assigned_at <= nb.completado_at) AS inicio,
      EXISTS (SELECT 1 FROM negocio_responsables nr
        WHERE nr.negocio_id = nb.negocio_id AND nr.rol IS NULL
          AND nr.assigned_at IS NOT NULL AND nr.assigned_at <= nb.completado_at) AS hay_sin_rol
    FROM negocio_bloques nb
    JOIN bloque_configs bc ON bc.id = nb.bloque_config_id AND bc.slug = 'radicado_de_certificacion'
    JOIN negocios ne ON ne.id = nb.negocio_id
    JOIN persona pe ON pe.profile_id = nb.completado_por AND pe.workspace_id = ne.workspace_id
    JOIN periodo p ON nb.completado_at >= p.desde AND nb.completado_at < p.hasta
    WHERE nb.completado_at IS NOT NULL
  ),
  medidos AS (
    SELECT c.*,
      CASE
        WHEN c.inicio IS NULL THEN NULL
        WHEN (SELECT radicacion_reloj FROM cfg) = 'corrido'
          THEN EXTRACT(EPOCH FROM (c.fin - c.inicio)) / 3600.0
        ELSE horas_habiles_jornada(
               c.inicio, c.fin,
               (SELECT jornada_sabado_habil FROM cfg),
               (SELECT jornada_inicio_hora  FROM cfg),
               (SELECT jornada_fin_hora     FROM cfg))
      END AS horas,
      EXTRACT(EPOCH FROM (c.fin - c.inicio)) / 3600.0 AS horas_corridas
    FROM casos c
  ),

  -- ---------- 2. Envio: las dos condiciones, y cual de las dos fallo ----------
  -- Espeja `envios` / `envio_agg` del resumen, expresion por expresion. Lo que
  -- agrega es el MOTIVO: un caso incumplido sin decir por que obliga a rehacer la
  -- cuenta a mano, que es lo que este panel viene a evitar.
  envios AS (
    SELECT ne.id AS negocio_id, ne.codigo, ne.nombre,
      nb.completado_at AS envio,
      (SELECT MAX(nb2.completado_at)
        FROM negocio_bloques nb2
        JOIN bloque_configs bc2 ON bc2.id = nb2.bloque_config_id AND bc2.slug = 'certificado_bancario'
        WHERE nb2.negocio_id = nb.negocio_id AND nb2.completado_at IS NOT NULL) AS cert_bancario,
      (SELECT MIN(v.value)
        FROM negocio_bloques nb3
        JOIN bloque_configs bc3 ON bc3.id = nb3.bloque_config_id AND bc3.slug = 'fecha_cita_dian'
        CROSS JOIN LATERAL jsonb_each_text(COALESCE(nb3.data, '{}'::jsonb)) AS v(key, value)
        WHERE nb3.negocio_id = nb.negocio_id
          AND v.value ~ '^\d{4}-\d{2}-\d{2}') AS cita_texto
    FROM negocio_bloques nb
    JOIN bloque_configs bc ON bc.id = nb.bloque_config_id AND bc.slug = 'confirmacion_envio_de_correo'
    JOIN negocios ne ON ne.id = nb.negocio_id
    JOIN persona pe ON pe.profile_id = nb.completado_por AND pe.workspace_id = ne.workspace_id
    JOIN periodo p ON nb.completado_at >= p.desde AND nb.completado_at < p.hasta
    WHERE nb.completado_at IS NOT NULL
  ),
  envios_medidos AS (
    SELECT e.*,
      -- Anclada a Bogota, igual que el resumen: la cita se guarda como fecha sin
      -- hora y `::timestamptz` la leeria en UTC, cinco horas mas estricto.
      CASE WHEN e.cita_texto IS NOT NULL
           THEN (substring(e.cita_texto from 1 for 10))::timestamp AT TIME ZONE 'America/Bogota'
      END AS cita
    FROM envios e
  ),
  envios_juzgados AS (
    SELECT em.*,
      CASE WHEN em.cert_bancario IS NOT NULL
           THEN EXTRACT(EPOCH FROM (em.envio - em.cert_bancario)) / 3600.0 END AS horas_desde_cert,
      CASE WHEN em.cita IS NOT NULL
           THEN EXTRACT(EPOCH FROM (em.cita - em.envio)) / 3600.0 END        AS horas_antes_cita,
      CASE
        WHEN em.cert_bancario IS NULL OR em.cita IS NULL THEN NULL
        ELSE em.envio <= em.cert_bancario + ((SELECT horas_desde_certificado FROM cfg) * interval '1 hour')
             AND em.envio <= em.cita - ((SELECT horas_antes_cita FROM cfg) * interval '1 hour')
      END AS a_tiempo
    FROM envios_medidos em
  ),

  -- ---------- 3. Radicaciones ante la DIAN: el denominador de correcciones ----------
  -- Todo caso que SALE HACIA ADELANTE de la etapa de envio. Colgarlo de la etapa y
  -- no de un bloque es lo que evita que el indicador se rompa en silencio cada vez
  -- que el proceso se reacomoda: el bloque anterior dejo de marcarse el 2026-08-12 y
  -- el denominador decia 8 cuando eran 40 y 43.
  etapa_radicacion AS (
    SELECT e.nombre, e.orden
    FROM etapas_negocio e
    JOIN lineas_negocio l ON l.id = e.linea_id
    JOIN persona pe       ON pe.workspace_id = l.workspace_id
    WHERE e.orden = (SELECT etapa_radicacion_dian_orden FROM cfg)
  ),
  dian AS (
    -- Un negocio puede salir de la etapa mas de una vez (reproceso). El resumen lo
    -- cuenta con DISTINCT, asi que aqui se agrupa por negocio: si la lista trajera
    -- dos filas del mismo caso, tendria mas renglones que el numero que la abrio.
    SELECT al.entidad_id AS negocio_id,
           MIN(al.created_at) AS momento,
           (array_agg(al.valor_nuevo ORDER BY al.created_at))[1] AS etapa_destino
    FROM activity_log al
    JOIN persona pe          ON pe.id = al.autor_id AND pe.workspace_id = al.workspace_id
    JOIN periodo p           ON al.created_at >= p.desde AND al.created_at < p.hasta
    JOIN etapa_radicacion er ON er.nombre = al.valor_anterior
    WHERE al.tipo = 'cambio_etapa'
      AND al.entidad_tipo = 'negocio'
      AND EXISTS (
        SELECT 1
        FROM etapas_negocio e2
        JOIN lineas_negocio l2 ON l2.id = e2.linea_id
        JOIN persona pe2       ON pe2.workspace_id = l2.workspace_id
        WHERE e2.nombre = al.valor_nuevo AND e2.orden > er.orden
      )
    GROUP BY al.entidad_id
  ),
  -- Que caso del denominador volvio devuelto, y por que causa. `error_propio` es la
  -- unica que baja el indicador; la de tercero se muestra igual, porque un 100% con
  -- devoluciones a la vista sin explicar se lee como que no hubo ninguna.
  devoluciones AS (
    SELECT re.negocio_id,
           bool_or(re.causa = 'error_propio') AS propia,
           COUNT(*)                           AS n
    FROM reproceso_eventos re
    JOIN persona pe ON pe.id = re.atribuido_a
    JOIN periodo p  ON re.abierto_at >= p.desde AND re.abierto_at < p.hasta
    WHERE re.tipo = 'devolucion_dian'
    GROUP BY re.negocio_id
  )

  SELECT jsonb_build_object(
    'staff_id', (SELECT id FROM persona),
    'nombre',   (SELECT full_name FROM persona),
    'radicaciones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'negocio_id', x.negocio_id, 'codigo', x.codigo, 'nombre', x.nombre,
        'inicio', x.inicio, 'fin', x.fin,
        'horas', ROUND(x.horas, 1),
        -- Las corridas viajan al lado para que la conversacion no se atasque en
        -- "a mi me dio otra cosa": la resta cruda es lo que cualquiera calcula.
        'horas_corridas', CASE WHEN x.inicio IS NOT NULL THEN ROUND(x.horas_corridas, 1) END,
        'a_tiempo', CASE WHEN x.inicio IS NULL THEN NULL
                         ELSE x.horas <= (SELECT horas_radicacion FROM cfg) END,
        -- Por que este caso no se pudo medir: distingue "nadie lo asigno" de "se
        -- asigno con una fila sin rol, que el motor no ve" (deuda #57).
        'sin_rol', x.hay_sin_rol
      ) ORDER BY x.fin DESC)
      FROM medidos x
    ), '[]'::jsonb),
    'envios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'negocio_id', e.negocio_id, 'codigo', e.codigo, 'nombre', e.nombre,
        'envio', e.envio,
        'cert_bancario', e.cert_bancario,
        'cita', e.cita,
        'horas_desde_cert', ROUND(e.horas_desde_cert, 1),
        'horas_antes_cita', ROUND(e.horas_antes_cita, 1),
        'a_tiempo', e.a_tiempo,
        -- Que le falto exactamente. Sin esto, un caso incumplido obliga a rehacer
        -- las dos cuentas a mano para saber cual de las dos condiciones fallo.
        'motivo', CASE
          WHEN e.cert_bancario IS NULL AND e.cita IS NULL THEN 'sin certificado bancario ni fecha de cita'
          WHEN e.cert_bancario IS NULL THEN 'sin certificado bancario'
          WHEN e.cita IS NULL          THEN 'sin fecha de cita'
          WHEN e.horas_desde_cert > (SELECT horas_desde_certificado FROM cfg)
               AND e.horas_antes_cita < (SELECT horas_antes_cita FROM cfg)
            THEN 'tarde desde el certificado y tarde frente a la cita'
          WHEN e.horas_desde_cert > (SELECT horas_desde_certificado FROM cfg)
            THEN 'tarde desde el certificado'
          WHEN e.horas_antes_cita < (SELECT horas_antes_cita FROM cfg)
            THEN 'tarde frente a la cita'
        END
      ) ORDER BY e.envio DESC)
      FROM envios_juzgados e
    ), '[]'::jsonb),
    'radicaciones_dian', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'negocio_id', d.negocio_id, 'codigo', ne.codigo, 'nombre', ne.nombre,
        'momento', d.momento,
        'etapa_destino', d.etapa_destino,
        -- null = no volvio. 'error_propio' = bajo el indicador. 'criterio_tercero'
        -- = volvio pero no castiga, igual que en calidad.
        'devuelto', CASE WHEN dv.negocio_id IS NULL THEN NULL
                         WHEN dv.propia THEN 'error_propio'
                         ELSE 'criterio_tercero' END
      ) ORDER BY d.momento DESC)
      FROM dian d
      JOIN negocios ne ON ne.id = d.negocio_id
      LEFT JOIN devoluciones dv ON dv.negocio_id = d.negocio_id
    ), '[]'::jsonb),
    'reprocesos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'negocio_id', re.negocio_id, 'codigo', ne.codigo, 'nombre', ne.nombre,
        'tipo', re.tipo, 'causa', re.causa, 'ciclo', re.ciclo,
        'detalle', re.detalle, 'abierto_at', re.abierto_at
      ) ORDER BY re.abierto_at DESC)
      FROM reproceso_eventos re
      JOIN negocios ne ON ne.id = re.negocio_id
      JOIN persona pe ON pe.id = re.atribuido_a
      JOIN periodo p ON re.abierto_at >= p.desde AND re.abierto_at < p.hasta
    ), '[]'::jsonb)
  )
  WHERE EXISTS (SELECT 1 FROM persona);
$function$;

REVOKE EXECUTE ON FUNCTION public.get_operaciones_bono_detalle(uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_operaciones_bono_detalle(uuid, integer, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_operaciones_bono_detalle(uuid, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_operaciones_bono_detalle(uuid, integer, integer) IS
  'Detalle caso por caso de los CUATRO indicadores del bono de operaciones: radicaciones con su reloj, envios con la condicion que fallo, radicaciones ante la DIAN (el denominador de correcciones, por salida de la etapa) y reprocesos. Resuelve la configuracion del MES igual que get_operaciones_bono_resumen: si el detalle leyera otra config, la lista contradiria al porcentaje. SECURITY DEFINER, scope al workspace del llamante.';
