-- El indicador de radicacion mide 72 h HABILES desde la ASIGNACION.
--
-- Es el 20% del bono de operaciones y hasta hoy medía otra cosa: horas corridas
-- desde la entrada a la etapa Cargue. Los dos desvios vienen de la migracion
-- original (20260804000001), que los dejo escritos como supuestos:
--
--     ⚠️ SUPUESTO: la supervisora dijo "72h desde que YO asigno", y ese momento
--     no se registra en ninguna parte [...]. La entrada a Cargue es la referencia
--     mas cercana que SI tiene historia.
--     ⚠️ Horas corridas, no habiles: es lo que dice el Excel.
--
-- Ninguno de los dos aplica ya. Deisy lo definio el 27 y el 29-jul como
-- "radicacion 72 h HABILES desde la asignacion", y `negocio_responsables.assigned_at`
-- esta poblado al 100%: 276 filas `comercial`, 201 `operaciones` (desde el
-- 2026-07-08) y 97 con `rol` NULL.
--
-- ⚠️ Las 72 h del ENVIO no cambian: `horas_antes_cita` sigue en horas CORRIDAS y
-- asi debe quedarse, porque ahi manda el calendario de la DIAN y no el de la
-- oficina. Los dos relojes conviven a proposito.
--
-- ── Lo que cambia el veredicto, medido en SOENA antes de aplicarlo ────────────────
--
--   Julio 2026 — 29 radicaciones
--     Cargue + corridas     : 29 medibles · 24 a tiempo (82,8%)
--     asignacion + corridas : 28 medibles · 26 a tiempo (92,9%)
--     asignacion + HABILES  : 28 medibles · 27 a tiempo (96,4%)   <- pasa el piso
--   Agosto 2026 — 33 radicaciones
--     Cargue + corridas     : 31 medibles · 21 a tiempo (67,7%)
--     asignacion + corridas : 33 medibles · 28 a tiempo (84,8%)
--     asignacion + HABILES  : 33 medibles · 31 a tiempo (93,9%)
--
-- No es cosmetico: con el piso de 95% de `config_bono_operaciones`, julio pasa de
-- NO pagar el indicador a pagarlo. Son 4 los casos que cambian de veredicto, y en
-- los cuatro la diferencia es un fin de semana o un festivo (V0040, V0129, V0123 y
-- V0316; el ultimo cruza el 17-ago, Asuncion de la Virgen). La cobertura sube en
-- agosto (33 medibles contra 31) porque hay casos que radicaron sin que el
-- `activity_log` registrara entrada a Cargue.
--
-- ── Lo que NO esta acordado y por eso es PARAMETRO, no constante ──────────────────
--
-- Que cuenta como hora habil no lo definio nadie. Los defaults reproducen la
-- convencion que el producto YA usa para el SLA de `/flujo` y `/equipo`
-- (`horas_habiles_entre`): **un dia habil vale 24 h**, sabado y domingo valen 0, y
-- los festivos salen de `festivos_colombia`. La pantalla los declara como supuesto
-- sin acordar, igual que ya hace con el piso de 95% y las 36/48 h del envio.
--
-- Cuanto mueve cada opcion, medido sobre los mismos casos (agosto):
--     dia habil = 24 h, sabado NO habil   -> 93,9%   (default)
--     dia habil = 24 h, sabado SI habil   -> 87,9%
--     jornada 8-18, sabado NO habil       -> 97,0%
-- Elegir jornada de 8 h cambia ademas el SIGNIFICADO del umbral: 72 h habiles
-- dejarian de ser 3 dias para ser 7,2 jornadas. Eso es decision de Deisy y
-- Mauricio, y se aplica con un UPDATE, sin desplegar.
--
-- ── Lo que este cambio NO tapa ────────────────────────────────────────────────────
--
-- (a) 97 filas de `negocio_responsables` tienen `rol` NULL (deuda #57, eran 53 el
--     11-ago). Para el motor son invisibles. Aqui se decide NO tomarlas como
--     asignacion —seria medirle al operativo un reloj que arranco cuando se asigno
--     el comercial— y en su lugar se cuentan aparte (`radicacion.sin_rol` por
--     persona, `responsables_sin_rol` del workspace). Hoy, en jul y ago, ninguna
--     radicacion cae en ese hueco: el contador nace en 0 y existe para el mes en
--     que deje de estarlo.
-- (b) `festivos_colombia` solo esta sembrada hasta el **2027-12-25**. A partir de
--     2028 los festivos contarian como habiles, en contra del operativo y sin
--     avisar. La RPC ahora devuelve `festivos_hasta_anio` y la pantalla lo advierte,
--     pero SEMBRAR los anios siguientes queda pendiente.
--
-- No crea tablas ni escribe datos de negocio: agrega 4 columnas de configuracion
-- con default, una funcion pura y redefine dos funciones.

-- ============================================================
-- 1. Parametros del reloj (politica, no codigo)
-- ============================================================

ALTER TABLE public.config_bono_operaciones
  ADD COLUMN IF NOT EXISTS radicacion_reloj text NOT NULL DEFAULT 'habil';

ALTER TABLE public.config_bono_operaciones
  DROP CONSTRAINT IF EXISTS config_bono_operaciones_radicacion_reloj_check;
ALTER TABLE public.config_bono_operaciones
  ADD CONSTRAINT config_bono_operaciones_radicacion_reloj_check
  CHECK (radicacion_reloj IN ('habil', 'corrido'));

ALTER TABLE public.config_bono_operaciones
  ADD COLUMN IF NOT EXISTS jornada_inicio_hora integer NOT NULL DEFAULT 0;
ALTER TABLE public.config_bono_operaciones
  ADD COLUMN IF NOT EXISTS jornada_fin_hora integer NOT NULL DEFAULT 24;
ALTER TABLE public.config_bono_operaciones
  ADD COLUMN IF NOT EXISTS jornada_sabado_habil boolean NOT NULL DEFAULT false;

ALTER TABLE public.config_bono_operaciones
  DROP CONSTRAINT IF EXISTS config_bono_operaciones_jornada_check;
ALTER TABLE public.config_bono_operaciones
  ADD CONSTRAINT config_bono_operaciones_jornada_check
  CHECK (jornada_inicio_hora >= 0 AND jornada_fin_hora <= 24
         AND jornada_fin_hora > jornada_inicio_hora);

COMMENT ON COLUMN public.config_bono_operaciones.radicacion_reloj IS
  'Con que reloj se miden las horas de radicacion. habil (default, acordado con Deisy 27-jul) descuenta fines de semana y festivos; corrido cuenta calendario. El indicador de ENVIO no usa esta columna: sus horas son corridas a proposito, porque miden contra la cita de la DIAN.';
COMMENT ON COLUMN public.config_bono_operaciones.jornada_inicio_hora IS
  'Hora de Bogota en que arranca la jornada habil. SUPUESTO no acordado: 0, o sea el dia habil completo vale 24 h, igual que el SLA del resto del producto. Cambiarlo mueve el significado del umbral.';
COMMENT ON COLUMN public.config_bono_operaciones.jornada_fin_hora IS
  'Hora de Bogota en que termina la jornada habil. SUPUESTO no acordado: 24.';
COMMENT ON COLUMN public.config_bono_operaciones.jornada_sabado_habil IS
  'SUPUESTO no acordado: false. Medido en SOENA (agosto 2026), encenderlo baja el indicador de 93,9% a 87,9%.';


-- ============================================================
-- 2. Horas de jornada habil — espejo de src/lib/negocios/horas-habiles.ts
-- ============================================================
--
-- ⚠️ NO reemplaza a `horas_habiles_entre`, y la diferencia no es cosmetica:
--   · `horas_habiles_entre` resta 24 h por cada dia no habil de [dia(ini), dia(fin))
--     —o sea NO descuenta el ultimo dia— y trunca los dias en la zona de la sesion,
--     que en esta base es UTC. Un viernes 12:00 -> sabado 12:00 le da 24 h habiles.
--     Es lo que alimenta el SLA de /flujo y /equipo; cambiarla movería veredictos
--     en esas pantallas y necesita su propia medicion. Queda como esta.
--   · Esta suma solo lo que cae DENTRO de la jornada de cada dia habil y corta los
--     dias en hora de BOGOTA. El mismo caso da 12 h.
-- Unificarlas es deuda declarada, no un olvido.
--
-- Las dos leen la MISMA tabla `festivos_colombia`: un solo calendario.

CREATE OR REPLACE FUNCTION public.horas_habiles_jornada(
  p_desde          timestamptz,
  p_hasta          timestamptz,
  p_sabado_habil   boolean DEFAULT false,
  p_jornada_inicio integer DEFAULT 0,
  p_jornada_fin    integer DEFAULT 24
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH parms AS (
    SELECT
      p_desde AS desde,
      p_hasta AS hasta,
      (p_desde AT TIME ZONE 'America/Bogota')::date AS dia_ini,
      (p_hasta AT TIME ZONE 'America/Bogota')::date AS dia_fin
  ),
  dias AS (
    SELECT d::date AS dia
    FROM parms, generate_series(parms.dia_ini, parms.dia_fin, interval '1 day') AS d
    WHERE p_desde IS NOT NULL AND p_hasta IS NOT NULL AND p_hasta > p_desde
      AND p_jornada_fin > p_jornada_inicio
  ),
  habiles AS (
    SELECT dia
    FROM dias
    WHERE EXTRACT(ISODOW FROM dia) <> 7
      AND (EXTRACT(ISODOW FROM dia) <> 6 OR p_sabado_habil)
      AND dia NOT IN (SELECT fecha FROM festivos_colombia)
  ),
  ventanas AS (
    -- La jornada se ancla a la medianoche de Bogota de cada dia habil.
    SELECT
      GREATEST(
        (SELECT desde FROM parms),
        (h.dia::timestamp AT TIME ZONE 'America/Bogota') + (p_jornada_inicio * interval '1 hour')
      ) AS ini,
      LEAST(
        (SELECT hasta FROM parms),
        (h.dia::timestamp AT TIME ZONE 'America/Bogota') + (p_jornada_fin * interval '1 hour')
      ) AS fin
    FROM habiles h
  )
  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (fin - ini)) / 3600.0), 0)
  FROM ventanas
  WHERE fin > ini;
$function$;

REVOKE EXECUTE ON FUNCTION public.horas_habiles_jornada(timestamptz, timestamptz, boolean, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.horas_habiles_jornada(timestamptz, timestamptz, boolean, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.horas_habiles_jornada(timestamptz, timestamptz, boolean, integer, integer) IS
  'Horas de jornada habil entre dos instantes, con los dias cortados en hora de Bogota. Espejo de horasHabilesEnJornada en src/lib/negocios/horas-habiles.ts. Distinta de horas_habiles_entre: aquella no descuenta el ultimo dia y trunca en UTC. Un anio ausente de festivos_colombia cuenta sus festivos como habiles.';


-- ============================================================
-- 3. El resumen del bono, con el reloj nuevo
-- ============================================================

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
  -- El reloj arranca en la ASIGNACION y corre en horas HABILES, que es lo que la
  -- supervisora dijo desde el principio ("72 h habiles desde que YO asigno").
  -- Hasta hoy arrancaba en la entrada a la etapa Cargue y contaba horas corridas:
  -- lo primero porque el momento de la asignacion no se registraba (ya se registra,
  -- `negocio_responsables.assigned_at` esta poblado al 100%), y lo segundo porque
  -- el Excel de origen contaba corridas y asi se implemento.
  --
  -- Se toma la ULTIMA asignacion de operaciones anterior a la radicacion, no la
  -- primera: si el caso se reasigna, el plazo corre para quien lo recibio. Medido
  -- en SOENA (jul y ago 2026): en las 61 radicaciones con asignacion, esa ultima
  -- asignacion siempre es la de la persona que radico, asi que la regla no le
  -- carga el tiempo de nadie a un tercero.
  --
  -- Solo cuentan las filas con `rol = 'operaciones'`. Las que tienen `rol` NULL
  -- (deuda #57) NO se cuelan como asignacion: se cuentan aparte en `sin_rol` para
  -- que la pantalla pueda decir cuantas quedaron fuera. Tomarlas seria medir el
  -- plazo del operativo contra el momento en que se asigno al comercial.
  radicaciones AS (
    SELECT
      ge.staff_id,
      nb.negocio_id,
      nb.completado_at AS fin,
      (
        SELECT MAX(nr.assigned_at)
        FROM negocio_responsables nr
        WHERE nr.negocio_id = nb.negocio_id
          AND nr.rol = 'operaciones'
          AND nr.assigned_at IS NOT NULL
          AND nr.assigned_at <= nb.completado_at
      ) AS inicio,
      -- El caso NO tiene asignacion de operaciones, pero SI tiene una fila de
      -- responsable sin rol declarado. Es "no medible por la deuda de rol", que no
      -- es lo mismo que "nunca se asigno": la pantalla las separa.
      EXISTS (
        SELECT 1
        FROM negocio_responsables nr
        WHERE nr.negocio_id = nb.negocio_id
          AND nr.rol IS NULL
          AND nr.assigned_at IS NOT NULL
          AND nr.assigned_at <= nb.completado_at
      ) AS hay_sin_rol
    FROM negocio_bloques nb
    JOIN bloque_configs bc ON bc.id = nb.bloque_config_id AND bc.slug = 'radicado_de_certificacion'
    JOIN negocios ne       ON ne.id = nb.negocio_id
    JOIN guard g           ON g.id = ne.workspace_id
    JOIN periodo p         ON nb.completado_at >= p.desde AND nb.completado_at < p.hasta
    JOIN gente ge          ON ge.profile_id = nb.completado_por
    WHERE nb.completado_at IS NOT NULL
  ),
  -- Las horas transcurridas se calculan UNA vez y con el reloj que declare la
  -- config. `horas_habiles_jornada` es la misma funcion que espeja el modulo
  -- `src/lib/negocios/horas-habiles.ts`.
  radicaciones_medidas AS (
    SELECT
      r.*,
      CASE
        WHEN r.inicio IS NULL THEN NULL
        WHEN (SELECT radicacion_reloj FROM cfg) = 'corrido'
          THEN EXTRACT(EPOCH FROM (r.fin - r.inicio)) / 3600.0
        ELSE horas_habiles_jornada(
               r.inicio, r.fin,
               (SELECT jornada_sabado_habil FROM cfg),
               (SELECT jornada_inicio_hora  FROM cfg),
               (SELECT jornada_fin_hora     FROM cfg))
      END AS horas
    FROM radicaciones r
  ),
  radicacion_agg AS (
    SELECT
      staff_id,
      COUNT(*)                                        AS eventos,
      COUNT(*) FILTER (WHERE inicio IS NOT NULL)      AS medibles,
      COUNT(*) FILTER (
        WHERE inicio IS NOT NULL
          AND horas <= (SELECT horas_radicacion FROM cfg)
      )                                               AS a_tiempo,
      -- Sin asignacion de operaciones y con una fila de rol NULL detras: el caso
      -- no se cuenta como cumplido ni como incumplido, se declara.
      COUNT(*) FILTER (WHERE inicio IS NULL AND hay_sin_rol) AS sin_rol
    FROM radicaciones_medidas
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
          -- La cita se guarda como fecha sin hora. `::timestamptz` la interpreta en la
          -- zona de la SESION, que en esta base es UTC: '2026-08-13' se volvia
          -- 13-ago 00:00 UTC = 12-ago 7:00 p.m. en Bogota, cinco horas mas estricto
          -- que la medianoche que se quiso escribir. Se ancla explicitamente a Bogota.
          AND envio <= ((substring(cita_texto from 1 for 10))::timestamp AT TIME ZONE 'America/Bogota')
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
      COALESCE(ra.sin_rol, 0)                  AS rad_sin_rol,
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
    -- Cuantas asignaciones del workspace siguen sin rol declarado. No es del mes:
    -- es la deuda #57 completa, y es lo que hace que un caso pueda quedar sin
    -- reloj. Se expone para que la pantalla la nombre en vez de esconderla.
    'responsables_sin_rol', COALESCE((
      SELECT COUNT(*)
      FROM negocio_responsables nr
      JOIN negocios ne ON ne.id = nr.negocio_id
      JOIN guard g     ON g.id = ne.workspace_id
      WHERE nr.rol IS NULL
    ), 0),
    -- Hasta que anio llega el calendario de festivos. Un anio sin sembrar no
    -- rompe nada: sus festivos se cuentan como habiles, en contra del operativo.
    -- La pantalla lo advierte cuando el periodo consultado se pasa de ese anio.
    'festivos_hasta_anio', (SELECT EXTRACT(YEAR FROM MAX(fecha))::int FROM festivos_colombia),
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
          'medibles', f.rad_medibles, 'eventos', f.rad_eventos,
          'sin_rol', f.rad_sin_rol),
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

REVOKE EXECUTE ON FUNCTION public.get_operaciones_bono_resumen(uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_operaciones_bono_resumen(uuid, integer, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_operaciones_bono_resumen(uuid, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_operaciones_bono_resumen(uuid, integer, integer) IS
  'Tablero de bono de operaciones para un mes: 4 indicadores por persona, con cobertura de datos, puntaje y bono. La radicacion se mide en horas HABILES desde negocio_responsables.assigned_at (rol operaciones), no en horas corridas desde la entrada a Cargue. SECURITY DEFINER, scope al workspace del llamante.';


-- ============================================================
-- 4. Detalle caso por caso: el MISMO reloj, o la lista contradice al indicador
-- ============================================================
-- Si el resumen cuenta horas habiles desde la asignacion y el detalle horas
-- corridas desde Cargue, quien abra su hoja para entender por que perdio el
-- indicador vera horas que no cuadran con el porcentaje. Es el mismo defecto que
-- este repo ya pago con la cifra comercial y su drill calculados por caminos
-- distintos.

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
  cfg AS (
    SELECT c.* FROM config_bono_operaciones c JOIN persona p ON p.workspace_id = c.workspace_id
  ),
  periodo AS (
    SELECT
      (make_date(p_anio, p_mes, 1)::timestamp AT TIME ZONE 'America/Bogota')                        AS desde,
      ((make_date(p_anio, p_mes, 1) + interval '1 month')::timestamp AT TIME ZONE 'America/Bogota') AS hasta
  ),
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
  'Detalle caso por caso del bono de operaciones. El reloj de radicacion arranca en la asignacion (negocio_responsables.assigned_at, rol operaciones) y corre en horas habiles: la MISMA referencia y el MISMO reloj que get_operaciones_bono_resumen. Devuelve tambien las horas corridas, para que la conversacion no se atasque en la resta cruda.';


-- Sin indice nuevo a proposito: `negocio_responsables` tiene 579 filas en toda la
-- base y ya trae `idx_negocio_responsables_negocio` sobre `negocio_id`, que es la
-- columna por la que entra este lookup. Un indice compuesto mas seria peso sin lector.

-- ============================================================
-- ROLLBACK (comentado):
--   Re-aplicar la definicion de 20260818000002_cita_dian_en_zona_bogota.sql para el
--   resumen y la de 20260804000001_bono_operaciones.sql para el detalle, y:
--     DROP FUNCTION IF EXISTS public.horas_habiles_jornada(timestamptz, timestamptz, boolean, integer, integer);
--     ALTER TABLE public.config_bono_operaciones
--       DROP COLUMN IF EXISTS radicacion_reloj,
--       DROP COLUMN IF EXISTS jornada_inicio_hora,
--       DROP COLUMN IF EXISTS jornada_fin_hora,
--       DROP COLUMN IF EXISTS jornada_sabado_habil;
--   Para volver SOLO al reloj corrido sin desplegar:
--     UPDATE config_bono_operaciones SET radicacion_reloj = 'corrido' WHERE workspace_id = '...';
-- ============================================================
