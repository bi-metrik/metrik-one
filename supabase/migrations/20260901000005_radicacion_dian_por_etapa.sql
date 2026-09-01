-- La radicacion ante la DIAN se mide por la ETAPA que el caso pasa, no por un bloque.
--
-- Definicion de Mauricio, 2026-09-01: "Radicado DIAN debe ser todo lo que pase la
-- etapa de envio. En ese momento se asegura que la informacion esta completa para
-- que el cliente la radique ante la DIAN."
--
-- Que estaba mal. El denominador colgaba del bloque `confirmacion_envio_a_dian`, y
-- ese bloque dejo de marcarse el 2026-08-12. NO fue descuido del equipo: el flujo
-- cambio y el hecho se mudo a la ruta de PQR (`radicado_pqr` en la etapa Cita y
-- `aviso_enlace_pqr` en Notificacion, ambos creados a fines de julio). Medido dia
-- a dia en agosto:
--
--   dia      confirmacion_envio_a_dian   radicado_pqr   aviso_enlace_pqr
--   08-11              8                      0                0
--   08-12              3                      5                1
--   08-13              0                     18                6
--   08-14 al 08-31     0                     37               60
--
-- El relevo es exacto. Y el efecto sobre el bono no era un sesgo pequeño: el
-- denominador de agosto decia 8 por persona cuando la realidad eran 40 y 43.
--
-- Peor que estar bajo: el numerador (devoluciones del mes) cubria agosto entero y
-- el denominador se cerraba el dia 12, asi que comparaba dos ventanas distintas. A
-- Maria Camila le costaba el indicador completo una devolucion abierta el 31 de
-- agosto, medida contra un denominador que dejo de contar el 12.
--
-- Por que la etapa y no otro bloque: los bloques se reacomodan cada vez que el
-- proceso cambia, y el indicador se rompe en silencio con cada reacomodo. La etapa
-- es el hito. Ademas es independiente de la ruta: hoy conviven `pqrs` (100 casos
-- en agosto) y `agenda` (37), y apuntar a `radicado_pqr` habria dejado fuera a los
-- de agenda, repitiendo el mismo error con otro nombre.
--
-- Se cuenta la salida HACIA ADELANTE. Un retroceso desde envio (reversa por regla,
-- devolucion que mueve etapa) no es una radicacion, y por eso se exige que la
-- etapa de destino tenga un `orden` mayor.
--
-- ⚠️ Trampa de identidad, verificada antes de construir: `activity_log.autor_id`
-- apunta a `staff.id`, NO a `profiles.id`, al reves que
-- `negocio_bloques.completado_por`, que es lo que usan los otros indicadores del
-- mismo bono. Sobre las 4.074 filas del workspace desde julio: 4.074 casan con
-- staff y CERO con profiles. Joinear la tabla equivocada no da error, da cero.
--
-- Cual es la etapa se vuelve configuracion (`etapa_radicacion_dian_orden`, por
-- defecto 14 = Envio en la linea GIT EV/HEV), no una constante en el codigo. Se
-- ancla al `orden` y no al `numero` de la etapa por la razon de siempre: el numero
-- ya se corrio una vez cuando entro "Revision radicado" el 2026-08-18.
--
-- Efecto medido, con el resto igual (piso 0,90, envio suspendido, solo error propio):
--   Jhon Fredy    0/40 -> 100%   20 pts   $360.000 sin cambio
--   Maria Camila  1/43 -> 97,7%  19,5 pts $350.769 -> ~$467.979
--
-- No toca datos de negocio: agrega una columna de configuracion con default y
-- reemplaza la funcion.

ALTER TABLE public.config_bono_operaciones
  ADD COLUMN IF NOT EXISTS etapa_radicacion_dian_orden integer NOT NULL DEFAULT 14;

COMMENT ON COLUMN public.config_bono_operaciones.etapa_radicacion_dian_orden IS
  'Orden de la etapa cuya SALIDA hacia adelante cuenta como una radicacion ante la DIAN. Se ancla al orden y no al numero: el numero ya se corrio una vez.';

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
    'parametros', COALESCE((SELECT to_jsonb(c) - 'workspace_id' FROM cfg c), '{}'::jsonb),
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
