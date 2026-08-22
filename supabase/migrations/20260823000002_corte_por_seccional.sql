-- El tablero comercial se puede cortar por SECCIONAL, y la capacidad se mide donde hay
-- con que medirla.  (Puntos #22 y #43 del inventario de SOENA.)
--
-- Mauricio cerro el 2026-08-22: el corte es por **seccional DIAN tal cual**, sin agrupar
-- en las 5 regiones de JD. Cero traduccion: el catalogo canonico que ONE ya escribe por
-- un solo camino desde el PR #236.
--
-- ── #22 · Cobertura medida en produccion (2026-08-22, linea GIT EV/HEV) ─────────
--
--   193 de 289 negocios tienen seccional; **96 no la tienen** (33%). El vocabulario ya
--   esta limpio: una sola grafia por ciudad (Bogota 123, Medellin 28, Cali 16,
--   Bucaramanga 8, Barranquilla 5, y 10 seccionales mas con 1-2 casos cada una).
--   Eso lo dejo el PR #236; antes Bogota estaba partida en tres y Medellin en dos.
--
--   Los 96 sin seccional van en su **propio bucket visible, con raya**. No se reparten
--   ni se esconden: un tercio de la cartera repartido a prorrata entre las ciudades
--   inventaria una distribucion que nadie midio, y escondido deja las columnas sin
--   sumar el total sin decir por que.
--
-- ── Por que la agregacion NO se hace aqui ───────────────────────────────────────
--
-- La RPC agrupa por el texto CRUDO de `negocios.metadata.seccional` y quien la consume
-- canoniza y colapsa con `canonizarSeccional` (`src/lib/dian/seccionales.ts`). Copiar
-- el catalogo de 35 seccionales a SQL crearia una segunda fuente que se desincroniza
-- el dia que la DIAN cambie una. Es el mismo camino que ya toma `getProcesoPorSeccional`
-- con las fotos historicas.
--
-- La RPC devuelve ademas los `negocio_ids` de cada grupo, para que al hacer clic en una
-- celda el drill abra EXACTAMENTE el conjunto que produjo el numero, y no una consulta
-- paralela que podria discrepar.
--
-- ── #43 · Capacidad por seccional: lo que hay y lo que NO hay ───────────────────
--
-- JD: "si en Bogota sacamos 18 citas al mes, el equipo comercial tiene cabida para 18
-- clientes de Bogota". Lo que importa es la capacidad POR SECCIONAL, no el total.
-- De las cuatro series que pidio, medidas contra produccion antes de escribir:
--
--   1. CITAS SACADAS ✅ — se fecha sola: la propia fecha de la cita. 68 casos, de
--      2026-08-06 a 2026-09-26. Septiembre en Bogota ya tiene **52** citas.
--   2. CERTIFICADOS UPME GENERADOS ⚠️ — no hay fuente limpia hacia atras. Ver abajo.
--   3. CERTIFICADOS CON ERROR ❌ — **no hay un solo registro**: `reproceso_eventos`
--      esta VACIA (0 filas) y en `negocios.metadata.reproceso` hay 1 marca, de tipo
--      `devolucion_dian`, no de certificado. La serie NO se dibuja en cero: un cero
--      ahi se leeria como "calidad perfecta", que es justo la afirmacion que nadie
--      puede hacer todavia.
--   4. PROCESOS FINALIZADOS ⚠️ — 5 negocios `completado` en toda la historia, y la
--      definicion de "finalizado" (#17: IVA devuelto o certificado entregado y sin
--      saldo) sigue SIN acordar. Se cuenta lo que hay y se dice que es `estado`.
--
--   ⚠️ Las DOS fuentes candidatas para "entro a Certificacion" discrepan, y la que
--   parecia mejor es la mala:
--
--     fuente                          negocios   jul   ago
--     min(negocio_bloques.created_at)     190     149    33
--     activity_log 'cambio_etapa'          64      31    33
--
--   La primera esta contaminada por la siembra de casillas: el trigger
--   `sembrar_casillas_al_crear_bloque` crea instancias en lote al crear un
--   `bloque_configs`, y se ven los dos picos — **168 negocios el 2026-08-10** y
--   **119 el 2026-07-30**, en un solo dia cada uno. Eso no es trabajo operativo, es
--   una migracion. Los dos meses coinciden en 33 para agosto: de ahi en adelante el
--   log es confiable, hacia atras no.
--
--   Por eso la serie de certificaciones sale del `activity_log` y **declara desde
--   cuando es confiable** en vez de pintar julio con un numero que seria 149 o 31
--   segun de donde se saque.
--
-- Esta migracion NO escribe datos: crea dos funciones.


-- ============================================================
-- 1. #22 · Las cifras del mes, abiertas por seccional
-- ============================================================
-- Mismas cifras del panel (cierres = ventas, 1er pago, 2o pago, valor total) sobre la
-- MISMA vista que las produce, para que el corte no pueda contradecir al total.

CREATE OR REPLACE FUNCTION public.get_comercial_seccional_mes_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer
)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  ventas AS (
    SELECT
      v.negocio_id,
      -- CRUDA a proposito: quien consume canoniza con el catalogo de TS. NULL y cadena
      -- vacia son la misma cosa (no se registro) y colapsan aqui para no producir dos
      -- buckets que en pantalla dirian lo mismo.
      NULLIF(TRIM(n.metadata->>'seccional'), '') AS seccional_cruda,
      v.honorario_sin_iva, v.honorario_con_iva,
      v.primer_pago, v.segundo_pago, v.honorario_recaudado,
      v.caso_completo, v.bonificable
    FROM v_venta_mes_comercial v
    JOIN guard g ON v.workspace_id = g.id
    JOIN negocios n ON n.id = v.negocio_id
    WHERE EXTRACT(YEAR  FROM v.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM v.fecha_venta) = p_mes
  )
  SELECT jsonb_build_object(
    'total_ventas', (SELECT COUNT(*) FROM ventas),
    'filas', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'ventas')::int DESC, x->>'seccional_cruda' NULLS LAST)
      FROM (
        SELECT jsonb_build_object(
          'seccional_cruda',  seccional_cruda,
          'ventas',           COUNT(*),
          'valor_sin_iva',    COALESCE(SUM(honorario_sin_iva), 0),
          'valor_con_iva',    COALESCE(SUM(honorario_con_iva), 0),
          'primer_pago',      COALESCE(SUM(primer_pago), 0),
          'segundo_pago',     COALESCE(SUM(segundo_pago), 0),
          'recaudado',        COALESCE(SUM(honorario_recaudado), 0),
          'casos_completos',  COUNT(*) FILTER (WHERE caso_completo),
          'bonificables',     CASE WHEN COUNT(*) = COUNT(*) FILTER (WHERE bonificable IS NULL)
                                   THEN NULL ELSE COUNT(*) FILTER (WHERE bonificable) END,
          -- Los casos exactos detras de la fila: el drill abre este conjunto y no
          -- una consulta paralela que podria dar otro.
          'negocio_ids',      jsonb_agg(negocio_id)
        ) AS x
        FROM ventas
        GROUP BY seccional_cruda
      ) t
    ), '[]'::jsonb)
  );
$function$;

COMMENT ON FUNCTION public.get_comercial_seccional_mes_soena(uuid, integer, integer) IS
  'Punto #22: las cifras del mes del tablero comercial abiertas por seccional DIAN. '
  'Consume v_venta_mes_comercial, la MISMA vista que el total. Devuelve la seccional '
  'CRUDA (quien consume canoniza con el catalogo de TS, fuente unica) y los negocio_ids '
  'de cada grupo, para que el drill abra exactamente el conjunto que produjo la cifra. '
  'La fila con seccional NULL es el bucket "sin registrar": va visible, no repartido.';

revoke execute on function public.get_comercial_seccional_mes_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_comercial_seccional_mes_soena(uuid, integer, integer) to authenticated;


-- ============================================================
-- 2. #43 · Capacidad mensual por seccional
-- ============================================================
-- Opt-in por LINEA. Sin `config_extra.capacidad` la funcion devuelve `null` y la
-- pantalla calla, en vez de inventar de donde sale cada serie:
--
--   "capacidad": {
--     "bloque_cita_slug": "fecha_cita_dian",   -- bloque `datos` con la fecha de la cita
--     "campo_cita":       "fecha_cita_dian",   -- su campo dentro de data
--     "etapa_certificacion_numero": 9          -- etapa cuya ENTRADA cuenta como certificado
--   }

CREATE OR REPLACE FUNCTION public.get_capacidad_seccional_soena(
  p_workspace_id uuid,
  p_desde date,
  p_hasta date
)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  cfg AS (
    SELECT l.id AS linea_id,
           l.config_extra->'capacidad'->>'bloque_cita_slug'            AS bloque_cita,
           l.config_extra->'capacidad'->>'campo_cita'                  AS campo_cita,
           (l.config_extra->'capacidad'->>'etapa_certificacion_numero')::int AS etapa_cert
    FROM lineas_negocio l, guard g
    WHERE l.workspace_id = g.id
      AND l.config_extra ? 'capacidad'
  ),
  neg AS (
    SELECT n.id, n.linea_id, n.estado, n.updated_at,
           NULLIF(TRIM(n.metadata->>'seccional'), '') AS seccional_cruda
    FROM negocios n, guard g
    WHERE n.workspace_id = g.id
      AND n.linea_id IN (SELECT linea_id FROM cfg)
  ),
  -- (1) CITAS — se fechan solas: la fecha de la cita ES el dato. El mes que importa
  -- para capacidad es el de la CITA, no el del registro: la DIAN da N cupos por mes.
  citas AS (
    SELECT neg.seccional_cruda,
           substr(nb.data->>c.campo_cita, 1, 7) AS mes,
           COUNT(*) AS n
    FROM negocio_bloques nb
    JOIN bloque_configs bc ON bc.id = nb.bloque_config_id
    JOIN etapas_negocio e  ON e.id = bc.etapa_id
    JOIN cfg c             ON c.linea_id = e.linea_id AND bc.slug = c.bloque_cita
    JOIN neg               ON neg.id = nb.negocio_id
    WHERE nb.data->>c.campo_cita ~ '^\d{4}-\d{2}-\d{2}'
      AND (nb.data->>c.campo_cita)::date >= p_desde
      AND (nb.data->>c.campo_cita)::date <  p_hasta
    GROUP BY 1, 2
  ),
  -- (2) CERTIFICACIONES — la ENTRADA a la etapa declarada, desde el rastro de cambios
  -- de etapa. NO se usa `negocio_bloques.created_at`: la siembra de casillas mete
  -- lotes de cientos en un dia y eso no es trabajo operativo (ver cabecera).
  cert AS (
    SELECT neg.seccional_cruda,
           to_char(x.entro, 'YYYY-MM') AS mes,
           COUNT(*) AS n
    FROM (
      SELECT a.entidad_id AS negocio_id, MIN(a.created_at) AS entro
      FROM activity_log a, guard g, cfg c
      JOIN etapas_negocio ec ON ec.linea_id = c.linea_id AND ec.numero = c.etapa_cert
      WHERE a.workspace_id = g.id
        AND a.entidad_tipo = 'negocio'
        AND a.tipo = 'cambio_etapa'
        AND a.valor_nuevo = ec.nombre
      GROUP BY a.entidad_id
    ) x
    JOIN neg ON neg.id = x.negocio_id
    WHERE x.entro >= p_desde AND x.entro < p_hasta
    GROUP BY 1, 2
  ),
  -- (4) FINALIZADOS — hoy es `estado = 'completado'`. La definicion #17 (IVA devuelto
  -- o certificado entregado y sin saldo) NO esta acordada, asi que la pantalla dice
  -- que esta contando el estado y no finge medir esa definicion.
  fin AS (
    SELECT neg.seccional_cruda, to_char(neg.updated_at, 'YYYY-MM') AS mes, COUNT(*) AS n
    FROM neg
    WHERE neg.estado = 'completado'
      AND neg.updated_at >= p_desde AND neg.updated_at < p_hasta
    GROUP BY 1, 2
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM cfg) THEN NULL ELSE jsonb_build_object(
    'desde', to_char(p_desde, 'YYYY-MM-DD'),
    'hasta', to_char(p_hasta, 'YYYY-MM-DD'),
    -- ⚠️ Este campo dice cuando ARRANCA el rastro, NO desde cuando es confiable. Son
    -- cosas distintas y confundirlas seria la clase de dato que se ve sano y miente:
    -- el rastro empieza en 2026-06 con 2 negocios, y julio esta a medias porque los
    -- casos que llegaron cargados ya avanzados nunca generaron una transicion.
    'rastro_etapas_desde',
      (SELECT to_char(MIN(a.created_at), 'YYYY-MM')
       FROM activity_log a, guard g
       WHERE a.workspace_id = g.id AND a.entidad_tipo = 'negocio' AND a.tipo = 'cambio_etapa'),
    -- La cobertura real de esa serie, para que la pantalla pueda declararla en vez de
    -- presentar el conteo como si fuera el total: cuantos casos tienen rastro de haber
    -- entrado a la etapa, sobre cuantos tienen evidencia de haber estado en ella.
    'certificaciones_cobertura', (
      SELECT jsonb_build_object(
        'con_rastro', (
          SELECT COUNT(DISTINCT a.entidad_id)
          FROM activity_log a, guard g
          JOIN cfg c ON true
          JOIN etapas_negocio ec ON ec.linea_id = c.linea_id AND ec.numero = c.etapa_cert
          WHERE a.workspace_id = g.id AND a.entidad_tipo = 'negocio'
            AND a.tipo = 'cambio_etapa' AND a.valor_nuevo = ec.nombre),
        'con_evidencia', (
          SELECT COUNT(DISTINCT nb.negocio_id)
          FROM negocio_bloques nb
          JOIN bloque_configs bc ON bc.id = nb.bloque_config_id
          JOIN etapas_negocio e  ON e.id = bc.etapa_id
          JOIN cfg c ON c.linea_id = e.linea_id AND e.numero = c.etapa_cert)
      )),
    -- ❌ Sin una sola fila: la serie NO se dibuja. Un cero diria "cero errores".
    'errores_sin_fuente',
      NOT EXISTS (SELECT 1 FROM reproceso_eventos re, guard g WHERE re.workspace_id = g.id),
    'citas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'seccional_cruda', seccional_cruda, 'mes', mes, 'n', n)) FROM citas), '[]'::jsonb),
    'certificaciones', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'seccional_cruda', seccional_cruda, 'mes', mes, 'n', n)) FROM cert), '[]'::jsonb),
    'finalizados', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'seccional_cruda', seccional_cruda, 'mes', mes, 'n', n)) FROM fin), '[]'::jsonb)
  ) END;
$function$;

COMMENT ON FUNCTION public.get_capacidad_seccional_soena(uuid, date, date) IS
  'Punto #43: cuanto puede procesar cada seccional por mes (citas, certificaciones, '
  'procesos finalizados). Opt-in por linea via config_extra.capacidad; sin esa clave '
  'devuelve NULL y la pantalla calla. Devuelve la seccional CRUDA para que quien la '
  'consuma canonice con el catalogo de TS. Declara errores_sin_fuente cuando no hay un '
  'solo reproceso registrado: esa serie no se dibuja en cero.';

revoke execute on function public.get_capacidad_seccional_soena(uuid, date, date) from public, anon;
grant  execute on function public.get_capacidad_seccional_soena(uuid, date, date) to authenticated;


-- ============================================================
-- 3. El drill abre un conjunto explicito de casos
-- ============================================================
-- Lo necesita el corte por seccional: la canonizacion vive en TS, asi que el servidor
-- no sabe que negocios caen en "Bogota". El consumidor ya los tiene (la RPC de arriba
-- se los dio) y los pasa; asi la lista es, por construccion, la que sumo la cifra.

DROP FUNCTION IF EXISTS public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean, date, text, boolean);

CREATE FUNCTION public.get_comercial_ventas_mes_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer,
  p_responsable_id uuid default null,
  p_solo_completos boolean default null,
  p_sin_responsable boolean default false,
  p_dia date default null,
  p_campana text default null,
  p_solo_bonificables boolean default null,
  -- Acota a un conjunto explicito de negocios. NULL = sin acotar. Un arreglo VACIO
  -- acota a nada y devuelve lista vacia, que es lo correcto: quien pide "estos casos"
  -- y no nombra ninguno no esta pidiendo todos.
  p_negocio_ids uuid[] default null
)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  ventas AS (
    SELECT v.*, a.tiene_rastro_meta, a.campana, a.ultima_conversion,
           a.n_conversiones, a.atribucion_en_conflicto, a.comision_retenida
    FROM v_venta_mes_comercial v
    JOIN guard g ON v.workspace_id = g.id
    LEFT JOIN v_negocio_atribucion a ON a.negocio_id = v.negocio_id
    WHERE EXTRACT(YEAR  FROM v.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM v.fecha_venta) = p_mes
      AND (p_dia IS NULL OR v.fecha_venta = p_dia)
      AND (CASE WHEN p_sin_responsable THEN v.responsable_id IS NULL
                WHEN p_responsable_id IS NOT NULL THEN v.responsable_id = p_responsable_id
                ELSE true END)
      AND (p_solo_completos IS NULL OR v.caso_completo = p_solo_completos)
      AND (p_solo_bonificables IS NULL OR v.bonificable = p_solo_bonificables)
      AND (p_negocio_ids IS NULL OR v.negocio_id = ANY(p_negocio_ids))
      AND (p_campana IS NULL
           OR (p_campana = '' AND a.campana IS NULL)
           OR a.campana = p_campana)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'negocio_id',       v.negocio_id,
    'codigo',           v.codigo,
    'nombre',           v.nombre,
    'estado',           v.estado,
    'responsable',      COALESCE(s.full_name, NULL),
    'fecha_venta',      to_char(v.fecha_venta, 'YYYY-MM-DD'),
    'fecha_completado', CASE WHEN v.caso_completo
                             THEN to_char(v.fecha_honorario_cubierto, 'YYYY-MM-DD') END,
    'fecha_creacion',   to_char(v.created_at, 'YYYY-MM-DD'),
    'ultima_conversion', to_char(v.ultima_conversion, 'YYYY-MM-DD'),
    'n_conversiones',   COALESCE(v.n_conversiones, 0),
    'origen_declarado', v.origen_declarado,
    'tiene_rastro_meta', COALESCE(v.tiene_rastro_meta, false),
    'campana',          v.campana,
    'atribucion_en_conflicto', COALESCE(v.atribucion_en_conflicto, false),
    'comision_retenida', COALESCE(v.comision_retenida, false),
    'valor_sin_iva',    v.honorario_sin_iva,
    'valor_con_iva',    v.honorario_con_iva,
    'recaudado',        v.honorario_recaudado,
    'primer_pago',      v.primer_pago,
    'segundo_pago',     v.segundo_pago,
    'caso_completo',    v.caso_completo,
    'bonificable',      v.bonificable,
    'sin_honorario_aprobado', (v.honorario_con_iva = 0)
  ) ORDER BY v.fecha_venta DESC, v.codigo), '[]'::jsonb)
  FROM ventas v
  LEFT JOIN staff s ON s.id = v.responsable_id;
$function$;

COMMENT ON FUNCTION public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean, date, text, boolean, uuid[]) IS
  'Drill del tablero comercial. Consume las MISMAS vistas que la cifra en la que se hizo '
  'clic. p_negocio_ids acota a un conjunto explicito, que es como el corte por seccional '
  '(#22) abre exactamente los casos que sumo, sin recalcular el criterio en el servidor.';

revoke execute on function public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean, date, text, boolean, uuid[]) from public, anon;
grant  execute on function public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean, date, text, boolean, uuid[]) to authenticated;
