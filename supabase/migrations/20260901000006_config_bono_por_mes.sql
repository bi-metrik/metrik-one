-- La configuracion del bono se vuelve mensual, y los meses pasados quedan congelados.
--
-- Pedido de Mauricio (2026-09-01): que SOENA ajuste su propio bono sin pasar por MeTRIK.
-- Que indicadores aplican y cuantos puntos vale cada uno tiene que poder cambiar mes a
-- mes: envio puede estar activo en agosto e inactivo en septiembre.
--
-- Hoy `config_bono_operaciones` tiene PK `workspace_id`: UNA fila, sin dimension de
-- tiempo. Con eso "activo en agosto, inactivo en septiembre" no se puede ni expresar, y
-- peor, cualquier ajuste reescribe el pasado. Hoy mismo la cifra de agosto se movio tres
-- veces en una sola jornada por cambios de politica; si esto hubiera estado en manos del
-- cliente, un bono ya pagado habria cambiado de valor sin que nadie pudiera explicar por que.
--
-- Decision de Mauricio, de las tres opciones que se le pusieron: **cada mes queda
-- congelado**. Editar octubre no mueve agosto.
--
-- Como se cumple, que es la parte facil de olvidar: la tabla de por defecto se queda para
-- los meses que nadie ha tocado, y la de mes manda cuando existe. Eso solo no alcanza: si
-- septiembre no tiene fila, cambiar el default en octubre lo moveria. Por eso el guardado
-- (en la server action) fija primero todo mes anterior al corriente que no tenga fila, con
-- lo que estaba rigiendo. Y por eso esta migracion siembra ya los meses con actividad.
--
-- Que NO trae esta migracion, a proposito: los puntos no se reparten solos. Mauricio eligio
-- escribirlos a mano y que la pantalla muestre el techo que resulte. Apagar envio sin
-- repartir deja el maximo en 80 y el bono tope en 24% del salario, dicho en pantalla.

CREATE TABLE IF NOT EXISTS public.config_bono_operaciones_mes (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  anio integer NOT NULL,
  mes  integer NOT NULL CHECK (mes BETWEEN 1 AND 12),

  -- Reparto de puntos. Suma libre a proposito: el techo es consecuencia, no restriccion.
  calidad_base              numeric NOT NULL DEFAULT 0.30,
  calidad_tramo             numeric NOT NULL DEFAULT 0.10,
  calidad_frac_un_malo      numeric NOT NULL DEFAULT 1.00,
  calidad_malos_pierde_todo integer NOT NULL DEFAULT 2,
  peso_radicacion           numeric NOT NULL DEFAULT 0.20,
  peso_envio                numeric NOT NULL DEFAULT 0.20,
  peso_correcciones         numeric NOT NULL DEFAULT 0.20,

  -- Umbrales. Es lo que Mauricio llamo "metas".
  piso_operativo          numeric NOT NULL DEFAULT 0.95,
  techo_operativo         numeric NOT NULL DEFAULT 1.00,
  horas_radicacion        integer NOT NULL DEFAULT 72,
  horas_desde_certificado integer NOT NULL DEFAULT 48,
  horas_antes_cita        integer NOT NULL DEFAULT 36,

  -- Reloj y jornada.
  radicacion_reloj     text    NOT NULL DEFAULT 'habil'
                               CHECK (radicacion_reloj IN ('habil','corrido')),
  jornada_inicio_hora  integer NOT NULL DEFAULT 0,
  jornada_fin_hora     integer NOT NULL DEFAULT 24,
  jornada_sabado_habil boolean NOT NULL DEFAULT false,

  -- Cobertura y fuentes.
  correcciones_cobertura      text    NOT NULL DEFAULT 'devolucion_dian'
                                      CHECK (correcciones_cobertura IN ('devolucion_dian','cualquier_reproceso')),
  etapa_radicacion_dian_orden integer NOT NULL DEFAULT 14,

  -- % del salario. No se pidio exponerlo en el panel, pero vive aqui para que el mes
  -- quede congelado COMPLETO: un mes que guarda sus pesos y hereda el % del salario del
  -- default no esta congelado, esta a medias.
  bono_max_pct          numeric NOT NULL DEFAULT 0.30,
  bono_max_pct_director numeric NOT NULL DEFAULT 0.15,
  piso_director         numeric NOT NULL DEFAULT 0.90,
  techo_director        numeric NOT NULL DEFAULT 1.00,

  actualizado_por uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT config_bono_operaciones_mes_pkey PRIMARY KEY (workspace_id, anio, mes),
  CONSTRAINT config_bono_operaciones_mes_jornada_check
    CHECK (jornada_inicio_hora >= 0 AND jornada_fin_hora <= 24 AND jornada_fin_hora > jornada_inicio_hora)
);

COMMENT ON TABLE public.config_bono_operaciones_mes IS
  'Configuracion del bono de operaciones para UN mes. Si existe, manda sobre config_bono_operaciones. Es lo que congela un mes ya liquidado: editar otro mes no lo toca.';

-- Mismo modelo que la tabla de por defecto: quien esta logueado LEE su workspace, y las
-- escrituras van por `service_role` desde las server actions. No se le da UPDATE a
-- `authenticated` ni con RLS: de esta tabla cuelga plata, y el gate de rol se decide en el
-- servidor, no en una politica que cualquiera con la sesion puede intentar.
ALTER TABLE public.config_bono_operaciones_mes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS config_bono_operaciones_mes_select ON public.config_bono_operaciones_mes;
CREATE POLICY config_bono_operaciones_mes_select
  ON public.config_bono_operaciones_mes
  FOR SELECT TO authenticated
  USING (workspace_id = (SELECT current_user_workspace_id()));

REVOKE ALL     ON public.config_bono_operaciones_mes FROM PUBLIC, anon;
GRANT  SELECT  ON public.config_bono_operaciones_mes TO authenticated;

-- Congelar = darle fila propia a todo mes pasado que todavia sigue el default, con lo
-- que ese default dice AHORA. Se llama desde la server action ANTES de guardar cualquier
-- cambio, y desde esta misma migracion para pinchar lo que ya existe.
--
-- Es la pieza que hace verdadero el "cada mes queda congelado". Sin ella, un mes sin fila
-- propia cae al default, y mover el default en octubre reescribiria septiembre.
--
-- Idempotente: `ON CONFLICT DO NOTHING`, asi que llamarla mil veces no pisa nada. El mes
-- EN CURSO no se congela: todavia esta vivo y su cifra se sigue moviendo sola.
CREATE OR REPLACE FUNCTION public.congelar_config_bono_meses_pasados(p_workspace_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH insertadas AS (
    INSERT INTO public.config_bono_operaciones_mes (
      workspace_id, anio, mes,
      calidad_base, calidad_tramo, calidad_frac_un_malo, calidad_malos_pierde_todo,
      peso_radicacion, peso_envio, peso_correcciones,
      piso_operativo, techo_operativo, horas_radicacion, horas_desde_certificado, horas_antes_cita,
      radicacion_reloj, jornada_inicio_hora, jornada_fin_hora, jornada_sabado_habil,
      correcciones_cobertura, etapa_radicacion_dian_orden,
      bono_max_pct, bono_max_pct_director, piso_director, techo_director)
    SELECT c.workspace_id, m.anio, m.mes,
      c.calidad_base, c.calidad_tramo, c.calidad_frac_un_malo, c.calidad_malos_pierde_todo,
      c.peso_radicacion, c.peso_envio, c.peso_correcciones,
      c.piso_operativo, c.techo_operativo, c.horas_radicacion, c.horas_desde_certificado, c.horas_antes_cita,
      c.radicacion_reloj, c.jornada_inicio_hora, c.jornada_fin_hora, c.jornada_sabado_habil,
      c.correcciones_cobertura, c.etapa_radicacion_dian_orden,
      c.bono_max_pct, c.bono_max_pct_director, c.piso_director, c.techo_director
    FROM public.config_bono_operaciones c
    CROSS JOIN LATERAL (
      -- Todo mes con trabajo con autor, hasta el mes ANTERIOR al corriente.
      SELECT DISTINCT
             EXTRACT(YEAR  FROM nb.completado_at AT TIME ZONE 'America/Bogota')::int AS anio,
             EXTRACT(MONTH FROM nb.completado_at AT TIME ZONE 'America/Bogota')::int AS mes
      FROM public.negocio_bloques nb
      JOIN public.negocios ne ON ne.id = nb.negocio_id AND ne.workspace_id = c.workspace_id
      WHERE nb.completado_at IS NOT NULL
        AND nb.completado_por IS NOT NULL
        AND nb.completado_at < date_trunc('month', now() AT TIME ZONE 'America/Bogota')
    ) m
    WHERE c.workspace_id = p_workspace_id
    ON CONFLICT (workspace_id, anio, mes) DO NOTHING
    RETURNING 1)
  SELECT COALESCE(COUNT(*), 0)::int FROM insertadas;
$function$;

COMMENT ON FUNCTION public.congelar_config_bono_meses_pasados(uuid) IS
  'Le da fila propia a todo mes pasado que aun sigue la config por defecto. Se llama antes de guardar un cambio de politica, para que ese cambio no reescriba meses ya liquidados.';

-- Solo el servidor la ejecuta: escribe la tabla de la que cuelga la plata.
REVOKE EXECUTE ON FUNCTION public.congelar_config_bono_meses_pasados(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.congelar_config_bono_meses_pasados(uuid) TO service_role;

-- Siembra inicial: pincha lo que ya existe, workspace por workspace.
SELECT public.congelar_config_bono_meses_pasados(c.workspace_id)
FROM public.config_bono_operaciones c;

-- La RPC resuelve la configuracion del mes con caida al default.

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
  -- La configuracion del mes MANDA sobre la de por defecto. Es lo que congela un mes
  -- ya liquidado: cambiar la politica en octubre no puede mover lo que se pago en
  -- agosto. Un mes sin fila propia cae al default, y la server action de guardado se
  -- encarga de fijar los meses viejos antes de dejar mover nada.
  cfg_default AS (
    SELECT c.* FROM config_bono_operaciones c, guard g WHERE c.workspace_id = g.id
  ),
  cfg_mes AS (
    SELECT m.* FROM config_bono_operaciones_mes m, guard g
    WHERE m.workspace_id = g.id AND m.anio = p_anio AND m.mes = p_mes
  ),
  cfg AS (
    SELECT
      COALESCE(m.calidad_base, d.calidad_base)                AS calidad_base,
      COALESCE(m.calidad_tramo, d.calidad_tramo)               AS calidad_tramo,
      COALESCE(m.calidad_frac_un_malo, d.calidad_frac_un_malo)        AS calidad_frac_un_malo,
      COALESCE(m.calidad_malos_pierde_todo, d.calidad_malos_pierde_todo)   AS calidad_malos_pierde_todo,
      COALESCE(m.peso_radicacion, d.peso_radicacion)             AS peso_radicacion,
      COALESCE(m.peso_envio, d.peso_envio)                  AS peso_envio,
      COALESCE(m.peso_correcciones, d.peso_correcciones)           AS peso_correcciones,
      COALESCE(m.piso_operativo, d.piso_operativo)              AS piso_operativo,
      COALESCE(m.techo_operativo, d.techo_operativo)             AS techo_operativo,
      COALESCE(m.horas_radicacion, d.horas_radicacion)            AS horas_radicacion,
      COALESCE(m.horas_desde_certificado, d.horas_desde_certificado)     AS horas_desde_certificado,
      COALESCE(m.horas_antes_cita, d.horas_antes_cita)            AS horas_antes_cita,
      COALESCE(m.radicacion_reloj, d.radicacion_reloj)            AS radicacion_reloj,
      COALESCE(m.jornada_inicio_hora, d.jornada_inicio_hora)         AS jornada_inicio_hora,
      COALESCE(m.jornada_fin_hora, d.jornada_fin_hora)            AS jornada_fin_hora,
      COALESCE(m.jornada_sabado_habil, d.jornada_sabado_habil)        AS jornada_sabado_habil,
      COALESCE(m.correcciones_cobertura, d.correcciones_cobertura)      AS correcciones_cobertura,
      COALESCE(m.etapa_radicacion_dian_orden, d.etapa_radicacion_dian_orden) AS etapa_radicacion_dian_orden,
      COALESCE(m.bono_max_pct, d.bono_max_pct)                AS bono_max_pct,
      COALESCE(m.bono_max_pct_director, d.bono_max_pct_director)       AS bono_max_pct_director,
      COALESCE(m.piso_director, d.piso_director)               AS piso_director,
      COALESCE(m.techo_director, d.techo_director)              AS techo_director,
      -- Para que la pantalla pueda decir si este mes tiene politica propia o esta
      -- siguiendo la de por defecto. Sin eso, nadie sabe que esta mirando.
      (m.workspace_id IS NOT NULL) AS es_del_mes
    FROM cfg_default d
    LEFT JOIN cfg_mes m ON true
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
           COUNT(*) FILTER (WHERE re.tipo = 'devolucion_dian'
                              AND re.causa = 'error_propio')  AS propias_mes,
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
  -- Denominador: TODO caso que PASA la etapa de envio, no un bloque suelto.
  -- Definicion de Mauricio (2026-09-01): al salir de esa etapa se asegura que la
  -- informacion esta completa para que el cliente radique ante la DIAN. Eso es la
  -- radicacion, sin importar por que ruta siga despues (PQR o cita por agenda).
  --
  -- Antes esto colgaba del bloque `confirmacion_envio_a_dian`, y ese bloque dejo
  -- de marcarse el 2026-08-12, cuando el flujo cambio a la ruta de PQR. El bloque
  -- no se abandono por descuido: el hecho se mudo a `radicado_pqr` (etapa Cita) y
  -- `aviso_enlace_pqr` (etapa Notificacion). Medido en agosto: el denominador
  -- decia 8 por persona cuando la realidad eran 40 y 43. Peor que estar bajo, el
  -- numerador cubria el mes entero y el denominador se cerraba el dia 12, o sea
  -- que comparaba ventanas distintas. A Maria Camila le costaba el indicador
  -- completo una devolucion abierta el 31, contra un denominador cerrado el 12.
  --
  -- Colgarlo de la etapa y no de un bloque es lo que evita que esto se repita: los
  -- bloques se reacomodan cuando el proceso cambia, la etapa es el hito.
  --
  -- Se cuenta la salida HACIA ADELANTE, no cualquier salida: un retroceso desde
  -- envio (reversa por regla, devolucion que mueve etapa) no es una radicacion.
  --
  -- ⚠️ `activity_log.autor_id` apunta a `staff.id`, NO a `profiles.id`, al reves
  -- que `negocio_bloques.completado_por`, que se usa en los otros indicadores.
  -- Verificado sobre las 4.074 filas del workspace desde julio: 4.074 casan con
  -- staff y CERO con profiles. Quien joinee la tabla equivocada aqui no recibe un
  -- error, recibe un cero, que es la peor forma de equivocarse en un bono.
  etapa_radicacion AS (
    SELECT e.nombre, e.orden
    FROM etapas_negocio e
    JOIN lineas_negocio l ON l.id = e.linea_id
    JOIN guard g          ON g.id = l.workspace_id
    WHERE e.orden = (SELECT etapa_radicacion_dian_orden FROM cfg)
  ),
  radicaciones_dian AS (
    SELECT al.autor_id AS staff_id, COUNT(DISTINCT al.entidad_id) AS n
    FROM activity_log al
    JOIN guard g              ON g.id = al.workspace_id
    JOIN periodo p            ON al.created_at >= p.desde AND al.created_at < p.hasta
    JOIN etapa_radicacion er  ON er.nombre = al.valor_anterior
    WHERE al.tipo = 'cambio_etapa'
      AND al.entidad_tipo = 'negocio'
      AND al.autor_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM etapas_negocio e2
        JOIN lineas_negocio l2 ON l2.id = e2.linea_id
        JOIN guard g2          ON g2.id = l2.workspace_id
        WHERE e2.nombre = al.valor_nuevo AND e2.orden > er.orden
      )
    GROUP BY al.autor_id
  ),
  -- Lo que NO castiga tambien se cuenta, para que la pantalla pueda decir por que
  -- un mes con devoluciones visibles no le bajo el indicador a nadie. Sin esto, la
  -- unica lectura posible seria "no hubo devoluciones", que es falsa.
  correcciones_terceros AS (
    SELECT re.atribuido_a AS staff_id, COUNT(*) AS n
    FROM reproceso_eventos re
    JOIN guard g   ON g.id = re.workspace_id
    JOIN periodo p ON re.abierto_at >= p.desde AND re.abierto_at < p.hasta
    WHERE re.tipo = 'devolucion_dian'
      AND re.causa <> 'error_propio'
      AND re.atribuido_a IS NOT NULL
    GROUP BY re.atribuido_a
  ),
  correcciones AS (
    SELECT re.atribuido_a AS staff_id, COUNT(*) AS n
    FROM reproceso_eventos re
    JOIN guard g   ON g.id = re.workspace_id
    JOIN periodo p ON re.abierto_at >= p.desde AND re.abierto_at < p.hasta
    WHERE re.tipo = 'devolucion_dian'
      -- Solo el error PROPIO castiga, igual que calidad (que ya filtraba asi).
      -- Antes contaba toda devolucion atribuida, incluida la marcada como
      -- `criterio_tercero`. Medido en SOENA (agosto 2026): a Jhon Fredy le
      -- costaba los 20 puntos completos el caso V0234, cuya nota dice que la
      -- DIAN alego que no habia cita. El propio registro decia que no fue culpa
      -- suya y el indicador lo cobraba igual.
      AND re.causa = 'error_propio'
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
      COALESCE(ct.n, 0)                        AS dian_terceros,
      CASE WHEN COALESCE(rd.n, 0) > 0
           THEN (rd.n - COALESCE(co.n, 0))::numeric / rd.n END AS pct_correcciones
    FROM gente ge
    LEFT JOIN calidad_agg      ca ON ca.staff_id = ge.staff_id
    LEFT JOIN radicacion_agg   ra ON ra.staff_id = ge.staff_id
    LEFT JOIN envio_agg        ea ON ea.staff_id = ge.staff_id
    LEFT JOIN radicaciones_dian rd ON rd.staff_id = ge.staff_id
    LEFT JOIN correcciones     co ON co.staff_id = ge.staff_id
    LEFT JOIN correcciones_terceros ct ON ct.staff_id = ge.staff_id
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
        -- Peso 0 = indicador SUSPENDIDO por politica. Va NULL, no 0: un cero es
        -- "se midio y no cumplio" y se pinta rojo; suspendido es "este mes no se
        -- juzga". Ademas, sin esta rama el bloque de abajo divide por el peso y
        -- la RPC entera se cae con 22012 division_by_zero: la pantalla no muestra
        -- un indicador en cero, se queda en blanco y nadie ve su bono.
        WHEN (SELECT peso_radicacion FROM cfg) = 0 THEN NULL
        WHEN b.malos >= (SELECT calidad_malos_pierde_todo FROM cfg) THEN 0
        WHEN b.pct_radicacion IS NULL THEN NULL
        WHEN b.pct_radicacion < (SELECT piso_operativo FROM cfg) THEN 0
        ELSE LEAST(b.pct_radicacion, (SELECT techo_operativo FROM cfg))
             / (SELECT techo_operativo FROM cfg) * (SELECT peso_radicacion FROM cfg)
      END AS score_radicacion,
      CASE
        -- Peso 0 = indicador SUSPENDIDO por politica. Va NULL, no 0: un cero es
        -- "se midio y no cumplio" y se pinta rojo; suspendido es "este mes no se
        -- juzga". Ademas, sin esta rama el bloque de abajo divide por el peso y
        -- la RPC entera se cae con 22012 division_by_zero: la pantalla no muestra
        -- un indicador en cero, se queda en blanco y nadie ve su bono.
        WHEN (SELECT peso_envio FROM cfg) = 0 THEN NULL
        WHEN b.malos >= (SELECT calidad_malos_pierde_todo FROM cfg) THEN 0
        WHEN b.pct_envio IS NULL THEN NULL
        WHEN b.pct_envio < (SELECT piso_operativo FROM cfg) THEN 0
        ELSE LEAST(b.pct_envio, (SELECT techo_operativo FROM cfg))
             / (SELECT techo_operativo FROM cfg) * (SELECT peso_envio FROM cfg)
      END AS score_envio,
      CASE
        -- Peso 0 = indicador SUSPENDIDO por politica. Va NULL, no 0: un cero es
        -- "se midio y no cumplio" y se pinta rojo; suspendido es "este mes no se
        -- juzga". Ademas, sin esta rama el bloque de abajo divide por el peso y
        -- la RPC entera se cae con 22012 division_by_zero: la pantalla no muestra
        -- un indicador en cero, se queda en blanco y nadie ve su bono.
        WHEN (SELECT peso_correcciones FROM cfg) = 0 THEN NULL
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
      -- Un indicador SUSPENDIDO no deja la fila incompleta: no es que falte su
      -- dato, es que la politica decidio no juzgarlo. "Incompleto" tiene que
      -- seguir significando "habia algo que medir y no se midio".
      (((SELECT peso_radicacion   FROM cfg) = 0 OR s.score_radicacion   IS NOT NULL)
        AND ((SELECT peso_envio        FROM cfg) = 0 OR s.score_envio        IS NOT NULL)
        AND ((SELECT peso_correcciones FROM cfg) = 0 OR s.score_correcciones IS NOT NULL)
        AND s.calidad_medida)                AS completo
    FROM scored s
  )
  SELECT jsonb_build_object(
    'periodo', jsonb_build_object('anio', p_anio, 'mes', p_mes),
    'parametros', COALESCE((SELECT to_jsonb(c) FROM cfg c), '{}'::jsonb),
    -- Techo real del mes. Suspender un indicador NO reparte su peso entre los
    -- demas: el maximo alcanzable baja. Con envio suspendido el techo es 0,80, o
    -- sea que el bono maximo deja de ser el 30% del salario y pasa al 24%. La
    -- pantalla tiene que poder decirlo; repartir el peso solo es una decision de
    -- politica y se toma moviendo los pesos, no aqui.
    'puntaje_maximo', (SELECT calidad_base + calidad_tramo + peso_radicacion
                              + peso_envio + peso_correcciones FROM cfg),
    'calidad_medida', COALESCE((SELECT eventos_mes FROM calidad_cobertura), 0) > 0,
    'reprocesos_mes', COALESCE((SELECT eventos_mes FROM calidad_cobertura), 0),
    'correcciones_medida', CASE COALESCE((SELECT correcciones_cobertura FROM cfg), 'devolucion_dian')
      WHEN 'cualquier_reproceso' THEN COALESCE((SELECT eventos_mes      FROM cobertura_correcciones), 0) > 0
      ELSE                            COALESCE((SELECT devoluciones_mes FROM cobertura_correcciones), 0) > 0
    END,
    'devoluciones_mes', COALESCE((SELECT devoluciones_mes FROM cobertura_correcciones), 0),
    'devoluciones_error_propio', COALESCE((SELECT propias_mes FROM cobertura_correcciones), 0),
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
          'terceros', f.dian_terceros,
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
        'completo', (prom.calidad IS NOT NULL
                     AND ((SELECT peso_radicacion   FROM cfg) = 0 OR prom.radicacion   IS NOT NULL)
                     AND ((SELECT peso_envio        FROM cfg) = 0 OR prom.envio        IS NOT NULL)
                     AND ((SELECT peso_correcciones FROM cfg) = 0 OR prom.correcciones IS NOT NULL)),
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
               ELSE LEAST(prom.calidad / NULLIF((SELECT calidad_base + calidad_tramo FROM cfg), 0),
                          (SELECT techo_director FROM cfg))
                    / (SELECT techo_director FROM cfg) * (SELECT calidad_base + calidad_tramo FROM cfg)
          END AS calidad,
          CASE WHEN (SELECT peso_radicacion FROM cfg) = 0 THEN NULL
               WHEN prom.radicacion IS NULL THEN NULL
               WHEN prom.radicacion / NULLIF((SELECT peso_radicacion FROM cfg), 0)
                    < (SELECT piso_director FROM cfg) THEN 0
               ELSE LEAST(prom.radicacion / NULLIF((SELECT peso_radicacion FROM cfg), 0),
                          (SELECT techo_director FROM cfg))
                    / (SELECT techo_director FROM cfg) * (SELECT peso_radicacion FROM cfg)
          END AS radicacion,
          CASE WHEN (SELECT peso_envio FROM cfg) = 0 THEN NULL
               WHEN prom.envio IS NULL THEN NULL
               WHEN prom.envio / NULLIF((SELECT peso_envio FROM cfg), 0)
                    < (SELECT piso_director FROM cfg) THEN 0
               ELSE LEAST(prom.envio / NULLIF((SELECT peso_envio FROM cfg), 0),
                          (SELECT techo_director FROM cfg))
                    / (SELECT techo_director FROM cfg) * (SELECT peso_envio FROM cfg)
          END AS envio,
          CASE WHEN (SELECT peso_correcciones FROM cfg) = 0 THEN NULL
               WHEN prom.correcciones IS NULL THEN NULL
               WHEN prom.correcciones / NULLIF((SELECT peso_correcciones FROM cfg), 0)
                    < (SELECT piso_director FROM cfg) THEN 0
               ELSE LEAST(prom.correcciones / NULLIF((SELECT peso_correcciones FROM cfg), 0),
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
