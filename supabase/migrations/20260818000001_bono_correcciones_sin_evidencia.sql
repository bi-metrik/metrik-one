-- El indicador de correcciones DIAN distingue "cero devoluciones" de "nadie midio".
--
-- El modulo nacio con una regla explicita (spec 2026-08-04, seccion 4): sin dato NO
-- es lo mismo que cumplido. Se aplico a calidad -- si el workspace no registro un
-- solo reproceso en el mes, `score_calidad` va NULL y no 40 puntos -- y se dejo
-- abierta en correcciones, que bebe de la MISMA tabla (`reproceso_eventos`, tipo
-- `devolucion_dian`).
--
-- Por que paso desapercibido: correcciones tiene dos fuentes. El denominador
-- (radicaciones ante la DIAN) sale de bloques completados y se mide solo; el
-- numerador (devoluciones) sale de reprocesos, que nadie registra. La cobertura se
-- estaba midiendo contra el denominador, asi que el indicador parecia cubierto.
--
-- Medido en SOENA antes de aplicarlo (agosto 2026): 0 filas en `reproceso_eventos`
-- en todo el workspace desde que existe la tabla, y aun asi Jhon Fredy (8
-- radicaciones) y Maria Camila (8) salian con correcciones al 100% y 0,20 puntos
-- cada uno -- el UNICO indicador que sumaba puntos, y el unico sin una sola
-- evidencia detras. Con este cambio los dos quedan en "sin medir" y su puntaje
-- pasa de 0,20 a 0,00, marcado como incompleto.
--
-- Que cuenta como evidencia es POLITICA, no codigo, y por eso es una columna de
-- `config_bono_operaciones` y no una constante: se cambia sin desplegar.
--   'devolucion_dian'     (default): exige devoluciones DIAN registradas en el mes.
--                         Conservador: en un mes limpio de verdad tampoco paga,
--                         hasta que el equipo registre reprocesos.
--   'cualquier_reproceso': basta con que el mecanismo se haya usado en el mes
--                         (mismo criterio que ya usa calidad).
-- Se deja en el conservador a proposito: es el que no reparte plata sin respaldo.
-- Deisy y Mauricio pueden moverlo con un UPDATE cuando decidan la politica.

ALTER TABLE public.config_bono_operaciones
  ADD COLUMN IF NOT EXISTS correcciones_cobertura text NOT NULL DEFAULT 'devolucion_dian';

ALTER TABLE public.config_bono_operaciones
  DROP CONSTRAINT IF EXISTS config_bono_operaciones_correcciones_cobertura_check;

ALTER TABLE public.config_bono_operaciones
  ADD CONSTRAINT config_bono_operaciones_correcciones_cobertura_check
  CHECK (correcciones_cobertura IN ('devolucion_dian', 'cualquier_reproceso'));

COMMENT ON COLUMN public.config_bono_operaciones.correcciones_cobertura IS
  'Que evidencia exige el indicador de correcciones para calcularse. devolucion_dian (default, conservador) = devoluciones DIAN registradas en el mes; cualquier_reproceso = cualquier reproceso del mes, igual que calidad. Sin la evidencia el score va NULL, no 100%.';


CREATE OR REPLACE FUNCTION public.get_operaciones_bono_resumen(p_workspace_id uuid, p_anio integer, p_mes integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  cfg AS (
    SELECT c.* FROM config_bono_operaciones c, guard g WHERE c.workspace_id = g.id
  ),
  -- Ventana del mes en hora de Bogota.
  periodo AS (
    SELECT
      (make_date(p_anio, p_mes, 1)::timestamp AT TIME ZONE 'America/Bogota')                     AS desde,
      ((make_date(p_anio, p_mes, 1) + interval '1 month')::timestamp AT TIME ZONE 'America/Bogota') AS hasta
  ),
  -- Universo: el area de operaciones, sin los inactivos.
  gente AS (
    SELECT s.id AS staff_id, s.full_name, s.position, s.profile_id, s.salary,
           -- Quien lidera se resuelve por ROL, no por el texto del cargo. `position` es
      -- campo libre: renombrar "Supervisor Operaciones" a "Coordinadora" metia a esa
      -- persona al ranking de ejecutores y le cambiaba la formula del bono, sin que
      -- nadie tocara el tablero. Verificado en SOENA antes del cambio: los dos
      -- criterios clasifican igual a las 4 personas del area, asi que no mueve a
      -- nadie hoy y deja de depender de como este escrito el cargo manana.
      COALESCE(pf.role IN ('owner','admin','supervisor'), false) AS es_supervisor
    FROM staff s
    JOIN staff_areas sa ON sa.staff_id = s.id AND sa.area = 'operaciones'
    JOIN guard g ON g.id = s.workspace_id
    LEFT JOIN profiles pf ON pf.id = s.profile_id
    WHERE s.is_active IS NOT FALSE
  ),

  -- ---------- 1. Radicacion dentro de la ventana ----------
  radicaciones AS (
    SELECT
      ge.staff_id,
      nb.negocio_id,
      nb.completado_at AS fin,
      (
        SELECT MAX(al.created_at)
        FROM activity_log al
        WHERE al.entidad_id = nb.negocio_id
          AND al.tipo = 'cambio_etapa'
          AND al.valor_nuevo = 'Cargue'
          AND al.created_at <= nb.completado_at
      ) AS inicio
    FROM negocio_bloques nb
    JOIN bloque_configs bc ON bc.id = nb.bloque_config_id AND bc.slug = 'radicado_de_certificacion'
    JOIN negocios ne       ON ne.id = nb.negocio_id
    JOIN guard g           ON g.id = ne.workspace_id
    JOIN periodo p         ON nb.completado_at >= p.desde AND nb.completado_at < p.hasta
    JOIN gente ge          ON ge.profile_id = nb.completado_por
    WHERE nb.completado_at IS NOT NULL
  ),
  radicacion_agg AS (
    SELECT
      staff_id,
      COUNT(*)                                        AS eventos,
      COUNT(*) FILTER (WHERE inicio IS NOT NULL)      AS medibles,
      COUNT(*) FILTER (
        WHERE inicio IS NOT NULL
          AND fin <= inicio + ((SELECT horas_radicacion FROM cfg) * interval '1 hour')
      )                                               AS a_tiempo
    FROM radicaciones
    GROUP BY staff_id
  ),

  -- ---------- 2. Calidad: certificados UPME malos por error propio ----------
  calidad_agg AS (
    SELECT re.atribuido_a AS staff_id, COUNT(*) AS malos
    FROM reproceso_eventos re
    JOIN guard g   ON g.id = re.workspace_id
    JOIN periodo p ON re.abierto_at >= p.desde AND re.abierto_at < p.hasta
    WHERE re.tipo = 'certificacion_upme'
      AND re.causa = 'error_propio'
      AND re.atribuido_a IS NOT NULL
    GROUP BY re.atribuido_a
  ),
  -- Cobertura del indicador de calidad: si el workspace no registro NI UN
  -- reproceso en el mes, "0 malos" no significa trabajo impecable, significa que
  -- nadie midio. Se reporta aparte para que la pantalla no mienta.
  calidad_cobertura AS (
    SELECT COUNT(*) AS eventos_mes
    FROM reproceso_eventos re
    JOIN guard g   ON g.id = re.workspace_id
    JOIN periodo p ON re.abierto_at >= p.desde AND re.abierto_at < p.hasta
  ),

  -- Cobertura del indicador de correcciones. Bebe de la MISMA tabla que calidad
  -- (`reproceso_eventos`) y arrastra el mismo riesgo, que aqui estaba sin tapar:
  -- con cero eventos registrados, "ninguna devolucion" no es trabajo impecable,
  -- es que nadie midio. Su denominador (radicaciones ante la DIAN) si se mide
  -- solo, y por eso el indicador parecia cubierto sin estarlo.
  -- Que cuenta como evidencia lo decide la config, no el codigo:
  --   'devolucion_dian'     (default, conservador): exige devoluciones del mes.
  --   'cualquier_reproceso': basta con que el mecanismo de reprocesos se haya usado.
  cobertura_correcciones AS (
    SELECT COUNT(*) FILTER (WHERE re.tipo = 'devolucion_dian') AS devoluciones_mes,
           COUNT(*)                                            AS eventos_mes
    FROM reproceso_eventos re
    JOIN guard g   ON g.id = re.workspace_id
    JOIN periodo p ON re.abierto_at >= p.desde AND re.abierto_at < p.hasta
  ),

  -- ---------- 3. Envio de documentacion al cliente ----------
  -- Dos condiciones (ambas del Excel): dentro de N horas del certificado
  -- bancario Y con N horas de anticipacion a la cita DIAN.
  envios AS (
    SELECT
      ge.staff_id,
      nb.completado_at AS envio,
      (
        SELECT MAX(nb2.completado_at)
        FROM negocio_bloques nb2
        JOIN bloque_configs bc2 ON bc2.id = nb2.bloque_config_id AND bc2.slug = 'certificado_bancario'
        WHERE nb2.negocio_id = nb.negocio_id AND nb2.completado_at IS NOT NULL
      ) AS cert_bancario,
      -- La fecha de la cita vive en el bloque `fecha_cita_dian`. Se lee de forma
      -- tolerante (primer valor con forma de fecha) porque hoy el bloque no tiene
      -- ni un dato en produccion y la clave exacta no esta fijada por uso.
      (
        SELECT MIN(v.value)
        FROM negocio_bloques nb3
        JOIN bloque_configs bc3 ON bc3.id = nb3.bloque_config_id AND bc3.slug = 'fecha_cita_dian'
        CROSS JOIN LATERAL jsonb_each_text(COALESCE(nb3.data, '{}'::jsonb)) AS v(key, value)
        WHERE nb3.negocio_id = nb.negocio_id
          AND v.value ~ '^\d{4}-\d{2}-\d{2}'
      ) AS cita_texto
    FROM negocio_bloques nb
    JOIN bloque_configs bc ON bc.id = nb.bloque_config_id AND bc.slug = 'confirmacion_envio_de_correo'
    JOIN negocios ne       ON ne.id = nb.negocio_id
    JOIN guard g           ON g.id = ne.workspace_id
    JOIN periodo p         ON nb.completado_at >= p.desde AND nb.completado_at < p.hasta
    JOIN gente ge          ON ge.profile_id = nb.completado_por
    WHERE nb.completado_at IS NOT NULL
  ),
  envio_agg AS (
    SELECT
      staff_id,
      COUNT(*)                                                          AS eventos,
      COUNT(*) FILTER (WHERE cert_bancario IS NOT NULL AND cita_texto IS NOT NULL) AS medibles,
      COUNT(*) FILTER (
        WHERE cert_bancario IS NOT NULL
          AND cita_texto IS NOT NULL
          AND envio <= cert_bancario + ((SELECT horas_desde_certificado FROM cfg) * interval '1 hour')
          AND envio <= (substring(cita_texto from 1 for 10))::timestamptz
                       - ((SELECT horas_antes_cita FROM cfg) * interval '1 hour')
      )                                                                 AS a_tiempo
    FROM envios
    GROUP BY staff_id
  ),

  -- ---------- 4. Correcciones DIAN vs radicaciones ante la DIAN ----------
  radicaciones_dian AS (
    SELECT ge.staff_id, COUNT(*) AS n
    FROM negocio_bloques nb
    JOIN bloque_configs bc ON bc.id = nb.bloque_config_id AND bc.slug = 'confirmacion_envio_a_dian'
    JOIN negocios ne       ON ne.id = nb.negocio_id
    JOIN guard g           ON g.id = ne.workspace_id
    JOIN periodo p         ON nb.completado_at >= p.desde AND nb.completado_at < p.hasta
    JOIN gente ge          ON ge.profile_id = nb.completado_por
    WHERE nb.completado_at IS NOT NULL
    GROUP BY ge.staff_id
  ),
  correcciones AS (
    SELECT re.atribuido_a AS staff_id, COUNT(*) AS n
    FROM reproceso_eventos re
    JOIN guard g   ON g.id = re.workspace_id
    JOIN periodo p ON re.abierto_at >= p.desde AND re.abierto_at < p.hasta
    WHERE re.tipo = 'devolucion_dian'
      AND re.atribuido_a IS NOT NULL
    GROUP BY re.atribuido_a
  ),

  -- ---------- Porcentajes y cobertura por persona ----------
  base AS (
    SELECT
      ge.staff_id, ge.full_name, ge.position, ge.salary, ge.es_supervisor,
      COALESCE(ca.malos, 0)                    AS malos,
      (SELECT eventos_mes FROM calidad_cobertura) > 0 AS calidad_medida,
      CASE COALESCE((SELECT correcciones_cobertura FROM cfg), 'devolucion_dian')
        WHEN 'cualquier_reproceso' THEN (SELECT eventos_mes      FROM cobertura_correcciones) > 0
        ELSE                            (SELECT devoluciones_mes FROM cobertura_correcciones) > 0
      END AS correcciones_medida,
      COALESCE(ra.medibles, 0)                 AS rad_medibles,
      COALESCE(ra.eventos, 0)                  AS rad_eventos,
      COALESCE(ra.a_tiempo, 0)                 AS rad_a_tiempo,
      CASE WHEN COALESCE(ra.medibles, 0) > 0
           THEN ra.a_tiempo::numeric / ra.medibles END AS pct_radicacion,
      COALESCE(ea.medibles, 0)                 AS env_medibles,
      COALESCE(ea.eventos, 0)                  AS env_eventos,
      COALESCE(ea.a_tiempo, 0)                 AS env_a_tiempo,
      CASE WHEN COALESCE(ea.medibles, 0) > 0
           THEN ea.a_tiempo::numeric / ea.medibles END AS pct_envio,
      COALESCE(rd.n, 0)                        AS dian_radicaciones,
      COALESCE(co.n, 0)                        AS dian_correcciones,
      CASE WHEN COALESCE(rd.n, 0) > 0
           THEN (rd.n - COALESCE(co.n, 0))::numeric / rd.n END AS pct_correcciones
    FROM gente ge
    LEFT JOIN calidad_agg      ca ON ca.staff_id = ge.staff_id
    LEFT JOIN radicacion_agg   ra ON ra.staff_id = ge.staff_id
    LEFT JOIN envio_agg        ea ON ea.staff_id = ge.staff_id
    LEFT JOIN radicaciones_dian rd ON rd.staff_id = ge.staff_id
    LEFT JOIN correcciones     co ON co.staff_id = ge.staff_id
    WHERE ge.es_supervisor = false
  ),
  -- ---------- Scores (formulas exactas del Excel) ----------
  scored AS (
    SELECT
      b.*,
      -- Calidad: 0 malos = base+tramo · 1 malo = tramo*frac · N+ = 0
      CASE
        -- Si en todo el mes NADIE registro un solo reproceso en el workspace,
        -- "0 certificados malos" no significa trabajo impecable: significa que
        -- el mecanismo no se uso. Devolver 0.40 aqui seria regalar 40 puntos sin
        -- una sola evidencia detras. Va NULL y el puntaje queda incompleto.
        -- En cambio, si el mes SI tuvo reprocesos y esta persona no tuvo ninguno,
        -- sus 40 puntos son reales: el mecanismo estaba vivo y ella salio limpia.
        WHEN NOT b.calidad_medida THEN NULL
        WHEN b.malos >= (SELECT calidad_malos_pierde_todo FROM cfg) THEN 0
        WHEN b.malos = 0 THEN (SELECT calidad_base + calidad_tramo FROM cfg)
        WHEN b.malos = 1 THEN (SELECT calidad_tramo * calidad_frac_un_malo FROM cfg)
        ELSE 0
      END AS score_calidad,
      -- Los tres indicadores de rango se anulan si la calidad se perdio.
      CASE
        WHEN b.malos >= (SELECT calidad_malos_pierde_todo FROM cfg) THEN 0
        WHEN b.pct_radicacion IS NULL THEN NULL
        WHEN b.pct_radicacion < (SELECT piso_operativo FROM cfg) THEN 0
        ELSE LEAST(b.pct_radicacion, (SELECT techo_operativo FROM cfg))
             / (SELECT techo_operativo FROM cfg) * (SELECT peso_radicacion FROM cfg)
      END AS score_radicacion,
      CASE
        WHEN b.malos >= (SELECT calidad_malos_pierde_todo FROM cfg) THEN 0
        WHEN b.pct_envio IS NULL THEN NULL
        WHEN b.pct_envio < (SELECT piso_operativo FROM cfg) THEN 0
        ELSE LEAST(b.pct_envio, (SELECT techo_operativo FROM cfg))
             / (SELECT techo_operativo FROM cfg) * (SELECT peso_envio FROM cfg)
      END AS score_envio,
      CASE
        WHEN b.malos >= (SELECT calidad_malos_pierde_todo FROM cfg) THEN 0
        -- Mismo criterio que calidad: sin un evento que lo respalde, el indicador
        -- no se calcula. Antes de este guard, quien tuviera radicaciones y cero
        -- devoluciones registradas se llevaba el peso completo sin evidencia.
        WHEN NOT b.correcciones_medida THEN NULL
        WHEN b.pct_correcciones IS NULL THEN NULL
        WHEN b.pct_correcciones < (SELECT piso_operativo FROM cfg) THEN 0
        ELSE LEAST(b.pct_correcciones, (SELECT techo_operativo FROM cfg))
             / (SELECT techo_operativo FROM cfg) * (SELECT peso_correcciones FROM cfg)
      END AS score_correcciones
    FROM base b
  ),
  final AS (
    SELECT
      s.*,
      -- Un indicador sin dato NO suma y NO resta: se excluye y el puntaje queda
      -- marcado como incompleto. Sumarlo como 0 castigaria a quien no tuvo casos.
      (COALESCE(s.score_calidad, 0)
        + COALESCE(s.score_radicacion, 0)
        + COALESCE(s.score_envio, 0)
        + COALESCE(s.score_correcciones, 0)) AS puntaje,
      (s.score_radicacion IS NOT NULL
        AND s.score_envio IS NOT NULL
        AND s.score_correcciones IS NOT NULL
        AND s.calidad_medida)                AS completo
    FROM scored s
  )
  SELECT jsonb_build_object(
    'periodo', jsonb_build_object('anio', p_anio, 'mes', p_mes),
    'parametros', COALESCE((SELECT to_jsonb(c) - 'workspace_id' FROM cfg c), '{}'::jsonb),
    'calidad_medida', COALESCE((SELECT eventos_mes FROM calidad_cobertura), 0) > 0,
    'reprocesos_mes', COALESCE((SELECT eventos_mes FROM calidad_cobertura), 0),
    'correcciones_medida', CASE COALESCE((SELECT correcciones_cobertura FROM cfg), 'devolucion_dian')
      WHEN 'cualquier_reproceso' THEN COALESCE((SELECT eventos_mes      FROM cobertura_correcciones), 0) > 0
      ELSE                            COALESCE((SELECT devoluciones_mes FROM cobertura_correcciones), 0) > 0
    END,
    'devoluciones_mes', COALESCE((SELECT devoluciones_mes FROM cobertura_correcciones), 0),
    'personas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'staff_id',            f.staff_id,
        'nombre',              f.full_name,
        'cargo',               f.position,
        'salario_registrado',  COALESCE(f.salary, 0) > 0,
        'malos',               f.malos,
        'calidad_medida',      f.calidad_medida,
        'radicacion', jsonb_build_object(
          'pct', f.pct_radicacion, 'a_tiempo', f.rad_a_tiempo,
          'medibles', f.rad_medibles, 'eventos', f.rad_eventos),
        'envio', jsonb_build_object(
          'pct', f.pct_envio, 'a_tiempo', f.env_a_tiempo,
          'medibles', f.env_medibles, 'eventos', f.env_eventos),
        'correcciones', jsonb_build_object(
          'pct', CASE WHEN f.correcciones_medida THEN f.pct_correcciones END,
          'radicaciones', f.dian_radicaciones,
          'correcciones', f.dian_correcciones,
          'medida', f.correcciones_medida),
        'score_calidad',       f.score_calidad,
        'score_radicacion',    f.score_radicacion,
        'score_envio',         f.score_envio,
        'score_correcciones',  f.score_correcciones,
        'puntaje',             f.puntaje,
        'completo',            f.completo,
        'bono',                ROUND(COALESCE(f.salary, 0) * (SELECT bono_max_pct FROM cfg) * f.puntaje)
      ) ORDER BY f.full_name)
      FROM final f
    ), '[]'::jsonb),
    'supervisor', (
      -- El bono del supervisor sale del promedio del equipo en CADA indicador,
      -- no del promedio del puntaje total. Es la formula del Excel.
      SELECT jsonb_build_object(
        'staff_id',           ge.staff_id,
        'nombre',             ge.full_name,
        'cargo',              ge.position,
        'salario_registrado', COALESCE(ge.salary, 0) > 0,
        'promedios', jsonb_build_object(
          'calidad',      prom.calidad,
          'radicacion',   prom.radicacion,
          'envio',        prom.envio,
          'correcciones', prom.correcciones),
        'aportes', jsonb_build_object(
          'calidad',      ap.calidad, 'radicacion', ap.radicacion,
          'envio',        ap.envio,   'correcciones', ap.correcciones),
        'puntaje', COALESCE(ap.calidad,0) + COALESCE(ap.radicacion,0)
                 + COALESCE(ap.envio,0)  + COALESCE(ap.correcciones,0),
        'completo', (prom.calidad IS NOT NULL AND prom.radicacion IS NOT NULL
                     AND prom.envio IS NOT NULL AND prom.correcciones IS NOT NULL),
        'bono', ROUND(COALESCE(ge.salary, 0) * (SELECT bono_max_pct_director FROM cfg)
                * (COALESCE(ap.calidad,0) + COALESCE(ap.radicacion,0)
                   + COALESCE(ap.envio,0) + COALESCE(ap.correcciones,0)))
      )
      FROM gente ge
      CROSS JOIN LATERAL (
        SELECT AVG(f.score_calidad)      AS calidad,
               AVG(f.score_radicacion)   AS radicacion,
               AVG(f.score_envio)        AS envio,
               AVG(f.score_correcciones) AS correcciones
        FROM final f
      ) prom
      CROSS JOIN LATERAL (
        SELECT
          CASE WHEN prom.calidad IS NULL THEN NULL
               WHEN prom.calidad / NULLIF((SELECT calidad_base + calidad_tramo FROM cfg), 0)
                    < (SELECT piso_director FROM cfg) THEN 0
               ELSE LEAST(prom.calidad / (SELECT calidad_base + calidad_tramo FROM cfg),
                          (SELECT techo_director FROM cfg))
                    / (SELECT techo_director FROM cfg) * (SELECT calidad_base + calidad_tramo FROM cfg)
          END AS calidad,
          CASE WHEN prom.radicacion IS NULL THEN NULL
               WHEN prom.radicacion / NULLIF((SELECT peso_radicacion FROM cfg), 0)
                    < (SELECT piso_director FROM cfg) THEN 0
               ELSE LEAST(prom.radicacion / (SELECT peso_radicacion FROM cfg),
                          (SELECT techo_director FROM cfg))
                    / (SELECT techo_director FROM cfg) * (SELECT peso_radicacion FROM cfg)
          END AS radicacion,
          CASE WHEN prom.envio IS NULL THEN NULL
               WHEN prom.envio / NULLIF((SELECT peso_envio FROM cfg), 0)
                    < (SELECT piso_director FROM cfg) THEN 0
               ELSE LEAST(prom.envio / (SELECT peso_envio FROM cfg),
                          (SELECT techo_director FROM cfg))
                    / (SELECT techo_director FROM cfg) * (SELECT peso_envio FROM cfg)
          END AS envio,
          CASE WHEN prom.correcciones IS NULL THEN NULL
               WHEN prom.correcciones / NULLIF((SELECT peso_correcciones FROM cfg), 0)
                    < (SELECT piso_director FROM cfg) THEN 0
               ELSE LEAST(prom.correcciones / (SELECT peso_correcciones FROM cfg),
                          (SELECT techo_director FROM cfg))
                    / (SELECT techo_director FROM cfg) * (SELECT peso_correcciones FROM cfg)
          END AS correcciones
      ) ap
      WHERE ge.es_supervisor = true
      LIMIT 1
    )
  );
$function$;

-- CREATE OR REPLACE conserva los grants de la definicion anterior; se re-declaran
-- para que esta migracion sea explicita y auto-contenida.
REVOKE EXECUTE ON FUNCTION public.get_operaciones_bono_resumen(uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_operaciones_bono_resumen(uuid, integer, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_operaciones_bono_resumen(uuid, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_operaciones_bono_resumen(uuid, integer, integer) IS
  'Tablero de bono de operaciones para un mes: 4 indicadores por persona, con cobertura de datos, puntaje y bono. Calidad Y correcciones van NULL si no hay reprocesos que las respalden. SECURITY DEFINER, scope al workspace del llamante. El filtro de quien ve el dinero es de la capa server.';

-- ============================================================
-- ROLLBACK (comentado):
--   Re-aplicar la definicion de 20260810000002_operaciones_supervisor_por_rol.sql
--   ALTER TABLE public.config_bono_operaciones DROP COLUMN IF EXISTS correcciones_cobertura;
-- ============================================================
