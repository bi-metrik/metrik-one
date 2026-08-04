-- ============================================================
-- 20260804000001 — Tablero de operaciones y bono por indicadores
-- ------------------------------------------------------------
-- Origen: reunion Deisy Ramirez (SOENA) 2026-07-27 + archivo
-- `Bono_Indicadores_Vehiculos_Electricos.xlsx`. Spec completa en
-- `proyectos/soena/ve/2026-08-04_spec-tablero-operaciones-bonos.md`.
--
-- Tres piezas:
--   1. `config_bono_operaciones` — los parametros de la politica, editables.
--      Equivale a la hoja `Parametros` del Excel. Nada hardcodeado en el codigo.
--   2. `reproceso_eventos` — un hecho por reproceso, con fecha, causa y a quien
--      se le atribuye. HACE FALTA: `negocios.metadata.reproceso` solo guarda el
--      ciclo VIGENTE de cada caso, asi que no sirve para contar "cuantos
--      certificados malos hubo en julio". Sin historial no hay indicador.
--   3. Dos RPCs: resumen del equipo y perfil de una persona.
--
-- ⚠️ REGLA CENTRAL DE ESTE TABLERO: sin dato NO es lo mismo que cumplido.
-- Cada indicador devuelve su porcentaje Y su cobertura (cuantos casos tenian el
-- dato necesario). Con 0 reprocesos registrados, la formula del Excel le daria
-- 40 puntos de calidad a todo el mundo; aqui eso se reporta como "sin medir",
-- no como "impecable". El puntaje total viaja con `completo` = false cuando
-- algun indicador no tiene con que calcularse.
--
-- Idempotente. Rollback al final.
-- ============================================================

-- ============================================================
-- 1. Parametros de la politica del bono
-- ============================================================

CREATE TABLE IF NOT EXISTS public.config_bono_operaciones (
  workspace_id              uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- Bono del operativo
  bono_max_pct              numeric NOT NULL DEFAULT 0.30,   -- % del salario

  -- 1. Calidad del certificado UPME (peso 40%)
  calidad_base              numeric NOT NULL DEFAULT 0.30,
  calidad_tramo             numeric NOT NULL DEFAULT 0.10,
  calidad_frac_un_malo      numeric NOT NULL DEFAULT 1.00,
  calidad_malos_pierde_todo integer NOT NULL DEFAULT 2,      -- N malos => pierde TODO el bono

  -- 2/3/4. Indicadores de rango (peso 20% cada uno)
  peso_radicacion           numeric NOT NULL DEFAULT 0.20,
  peso_envio                numeric NOT NULL DEFAULT 0.20,
  peso_correcciones         numeric NOT NULL DEFAULT 0.20,
  piso_operativo            numeric NOT NULL DEFAULT 0.95,   -- por debajo, el indicador vale 0
  techo_operativo           numeric NOT NULL DEFAULT 1.00,

  -- Ventanas de tiempo
  horas_radicacion          integer NOT NULL DEFAULT 72,     -- horas para radicar desde la entrada a Cargue
  horas_desde_certificado   integer NOT NULL DEFAULT 48,     -- envio dentro de N horas del certificado bancario
  horas_antes_cita          integer NOT NULL DEFAULT 36,     -- envio con N horas de anticipacion a la cita

  -- Bono del supervisor
  bono_max_pct_director     numeric NOT NULL DEFAULT 0.15,
  piso_director             numeric NOT NULL DEFAULT 0.90,
  techo_director            numeric NOT NULL DEFAULT 1.00,

  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.config_bono_operaciones IS
  'Parametros de la politica de bono de operaciones, por workspace. Equivale a la hoja Parametros del Excel de SOENA. horas_antes_cita=36 y horas_desde_certificado=48 son SUPUESTOS del archivo, no acordados con la supervisora (ella dijo "por lo menos un dia antes"): se dejan configurables y la pantalla los declara.';

ALTER TABLE public.config_bono_operaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS config_bono_operaciones_select ON public.config_bono_operaciones;
CREATE POLICY config_bono_operaciones_select ON public.config_bono_operaciones
  FOR SELECT TO authenticated
  USING (workspace_id = current_user_workspace_id());

-- ⚠️ El GRANT no basta: en este proyecto toda tabla nueva NACE con todos los
-- privilegios para `anon` y `authenticated` (verificado al aplicar esta misma
-- migracion: ambas tablas salieron con INSERT/UPDATE/DELETE/TRUNCATE para anon).
-- RLS tapa el DML, pero NO cubre TRUNCATE: sin el REVOKE, cualquiera con la anon
-- key —que viaja en el bundle del browser— podria vaciar la tabla. Primero se
-- revoca todo, despues se da lo unico que se necesita.
REVOKE ALL ON public.config_bono_operaciones FROM anon;
REVOKE ALL ON public.config_bono_operaciones FROM authenticated;
-- Solo lectura para el cliente. La escritura va server-side (service_role), que
-- bypasea RLS y grants: no hace falta darle nada a `authenticated`.
GRANT SELECT ON public.config_bono_operaciones TO authenticated;

-- Semilla para SOENA con los valores del Excel.
INSERT INTO public.config_bono_operaciones (workspace_id)
SELECT '7dea141d-d4da-483d-a78d-b14ef35500c5'::uuid
WHERE EXISTS (SELECT 1 FROM public.workspaces WHERE id = '7dea141d-d4da-483d-a78d-b14ef35500c5')
ON CONFLICT (workspace_id) DO NOTHING;


-- ============================================================
-- 2. Historial de reprocesos — el insumo del indicador de calidad
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reproceso_eventos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  negocio_id    uuid NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
  ciclo         integer NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('certificacion_upme', 'devolucion_dian')),
  causa         text NOT NULL CHECK (causa IN ('error_propio', 'criterio_tercero')),
  detalle       text,
  -- A quien se le carga la falla: quien hizo el trabajo que hubo que rehacer,
  -- NO quien abrio el reproceso (eso siempre es la supervisora). Se resuelve al
  -- abrirlo, contra `completado_por` del bloque del tramo. NULL = no se pudo
  -- atribuir (p.ej. el trabajo entro por cargue masivo, sin autor).
  atribuido_a   uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  abierto_por   uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  abierto_at    timestamptz NOT NULL DEFAULT now(),
  cerrado_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.reproceso_eventos IS
  'Un hecho por reproceso abierto. `negocios.metadata.reproceso` solo conserva el ciclo vigente, asi que no permite contar reprocesos por periodo; esta tabla si. `atribuido_a` es quien hizo el trabajo que se rehace, no quien lo reporta.';

CREATE INDEX IF NOT EXISTS reproceso_eventos_ws_fecha_idx
  ON public.reproceso_eventos (workspace_id, abierto_at);
CREATE INDEX IF NOT EXISTS reproceso_eventos_atribuido_idx
  ON public.reproceso_eventos (atribuido_a, abierto_at);
CREATE INDEX IF NOT EXISTS reproceso_eventos_negocio_idx
  ON public.reproceso_eventos (negocio_id);

ALTER TABLE public.reproceso_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reproceso_eventos_select ON public.reproceso_eventos;
CREATE POLICY reproceso_eventos_select ON public.reproceso_eventos
  FOR SELECT TO authenticated
  USING (workspace_id = current_user_workspace_id());

-- Mismo REVOKE previo que en la tabla de arriba, y por la misma razon: sin el,
-- un operativo podria borrar los reprocesos que le penalizan el bono.
REVOKE ALL ON public.reproceso_eventos FROM anon;
REVOKE ALL ON public.reproceso_eventos FROM authenticated;
-- Lectura para la app (timeline del negocio); la escritura la hace el server
-- action con service_role al abrir/cerrar el reproceso.
GRANT SELECT ON public.reproceso_eventos TO authenticated;


-- ============================================================
-- 3. RPC — resumen del equipo de operaciones para un mes
-- ============================================================
--
-- Devuelve una fila por persona del area `operaciones` (staff_areas), con los
-- cuatro indicadores, su cobertura, el puntaje y el bono. El bono viaja en la
-- respuesta; QUIEN puede verlo lo decide la capa server (un operativo solo ve
-- el propio). El salario nunca sale de aqui.
--
-- Fuentes, todas verificadas en produccion 2026-08-04:
--   · Atribucion del trabajo: `negocio_bloques.completado_por` -> profiles.id
--     -> staff.profile_id. NO `negocios.responsable_id`, que apunta a staff.id y
--     refleja al COMERCIAL dueno del caso, no al operativo que lo trabaja.
--   · Radicacion: inicio = entrada del negocio a la etapa "Cargue"
--     (`activity_log`, tipo `cambio_etapa`, valor_nuevo = 'Cargue'), fin =
--     `completado_at` del bloque `radicado_de_certificacion`.
--     ⚠️ SUPUESTO: la supervisora dijo "72h desde que YO asigno", y ese momento
--     no se registra en ninguna parte (no hay `asignado_at` y `activity_log` no
--     audita cambios de responsable). La entrada a Cargue es la referencia mas
--     cercana que SI tiene historia. La pantalla lo declara.
--     ⚠️ Horas corridas, no habiles: es lo que dice el Excel.
--   · Calidad y correcciones: `reproceso_eventos`.
--   · Envio: `confirmacion_envio_de_correo` contra el certificado bancario y la
--     fecha de la cita DIAN.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_operaciones_bono_resumen(uuid, integer, integer);

CREATE FUNCTION public.get_operaciones_bono_resumen(
  p_workspace_id uuid,
  p_anio         integer,
  p_mes          integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
           (s.position ILIKE 'Supervisor%') AS es_supervisor
    FROM staff s
    JOIN staff_areas sa ON sa.staff_id = s.id AND sa.area = 'operaciones'
    JOIN guard g ON g.id = s.workspace_id
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
          'pct', f.pct_correcciones, 'radicaciones', f.dian_radicaciones,
          'correcciones', f.dian_correcciones),
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
$$;

REVOKE EXECUTE ON FUNCTION public.get_operaciones_bono_resumen(uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_operaciones_bono_resumen(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_operaciones_bono_resumen(uuid, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_operaciones_bono_resumen(uuid, integer, integer) IS
  'Tablero de bono de operaciones para un mes: 4 indicadores por persona, con cobertura de datos, puntaje y bono. SECURITY DEFINER, scope al workspace del llamante. El filtro de quien ve el dinero es de la capa server.';


-- ============================================================
-- 4. RPC — detalle caso por caso de una persona
-- ============================================================
-- Alimenta la hoja individual: no basta con el porcentaje, hay que poder ver
-- cual caso fallo y por que.

DROP FUNCTION IF EXISTS public.get_operaciones_bono_detalle(uuid, integer, integer);

CREATE FUNCTION public.get_operaciones_bono_detalle(
  p_staff_id uuid,
  p_anio     integer,
  p_mes      integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH persona AS (
    SELECT s.id, s.full_name, s.position, s.profile_id, s.workspace_id
    FROM staff s
    WHERE s.id = p_staff_id
      AND s.workspace_id = current_user_workspace_id()
  ),
  cfg AS (
    SELECT c.* FROM config_bono_operaciones c JOIN persona p ON p.workspace_id = c.workspace_id
  ),
  periodo AS (
    SELECT
      (make_date(p_anio, p_mes, 1)::timestamp AT TIME ZONE 'America/Bogota')                        AS desde,
      ((make_date(p_anio, p_mes, 1) + interval '1 month')::timestamp AT TIME ZONE 'America/Bogota') AS hasta
  )
  SELECT jsonb_build_object(
    'staff_id', (SELECT id FROM persona),
    'nombre',   (SELECT full_name FROM persona),
    'radicaciones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'negocio_id', x.negocio_id, 'codigo', x.codigo, 'nombre', x.nombre,
        'inicio', x.inicio, 'fin', x.fin,
        'horas', CASE WHEN x.inicio IS NOT NULL
                      THEN ROUND(EXTRACT(EPOCH FROM (x.fin - x.inicio)) / 3600.0, 1) END,
        'a_tiempo', CASE WHEN x.inicio IS NULL THEN NULL
                         ELSE x.fin <= x.inicio + ((SELECT horas_radicacion FROM cfg) * interval '1 hour') END
      ) ORDER BY x.fin DESC)
      FROM (
        SELECT ne.id AS negocio_id, ne.codigo, ne.nombre, nb.completado_at AS fin,
          (SELECT MAX(al.created_at) FROM activity_log al
            WHERE al.entidad_id = nb.negocio_id AND al.tipo = 'cambio_etapa'
              AND al.valor_nuevo = 'Cargue' AND al.created_at <= nb.completado_at) AS inicio
        FROM negocio_bloques nb
        JOIN bloque_configs bc ON bc.id = nb.bloque_config_id AND bc.slug = 'radicado_de_certificacion'
        JOIN negocios ne ON ne.id = nb.negocio_id
        JOIN persona pe ON pe.profile_id = nb.completado_por AND pe.workspace_id = ne.workspace_id
        JOIN periodo p ON nb.completado_at >= p.desde AND nb.completado_at < p.hasta
        WHERE nb.completado_at IS NOT NULL
      ) x
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
$$;

REVOKE EXECUTE ON FUNCTION public.get_operaciones_bono_detalle(uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_operaciones_bono_detalle(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_operaciones_bono_detalle(uuid, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_operaciones_bono_detalle(uuid, integer, integer) IS
  'Detalle caso por caso de una persona de operaciones en un mes: radicaciones con sus horas y reprocesos atribuidos. SECURITY DEFINER, scope al workspace del llamante.';


-- ============================================================
-- ROLLBACK (comentado):
--   DROP FUNCTION IF EXISTS public.get_operaciones_bono_detalle(uuid, integer, integer);
--   DROP FUNCTION IF EXISTS public.get_operaciones_bono_resumen(uuid, integer, integer);
--   DROP TABLE IF EXISTS public.reproceso_eventos;
--   DROP TABLE IF EXISTS public.config_bono_operaciones;
-- ============================================================
