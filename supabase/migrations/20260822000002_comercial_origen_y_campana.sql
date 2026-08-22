-- El cierre comercial dice de donde vino el lead y con que campana, o dice que no lo sabe.
--
-- El origen decide la comision (16% marketing contra 20% directo), y hasta hoy la
-- pantalla comercial no lo mostraba en ninguna parte. El dato ya existe, pero por
-- DOS caminos que no siempre coinciden, y esa discrepancia es justo lo que hay que
-- poner a la vista en vez de resolverla a dedo:
--
--   1. `negocios.origen` — lo DECLARA quien crea el negocio (catalogo en
--      src/lib/catalogos/constants.ts).
--   2. `contacto_interacciones` con `fuente='meta'` — el RASTRO real del formulario
--      de Meta, con `payload->>'campaign_name'`.
--
-- ── Medido en SOENA el 2026-08-22, antes de escribir nada ─────────────────────────
--
--   289 negocios. `negocios.origen`: otro 125 · meta 61 · NULL 59 · promotor 18 ·
--   contacto_directo 18 · referido 7 · web_organico 1.
--
--   518 interacciones de Meta en el workspace, **todas** con `campaign_id` y
--   `campaign_name` (el backfill del 20-ago cerro ese hueco: ver
--   docs/specs/2026-08-20_backfill-atribucion-meta.md). Solo **14** traen
--   `negocio_id` directo, asi que el camino util es por el contacto.
--
--   Cruce origen declarado x rastro de Meta:
--     meta             + rastro : 35    <- declarado y respaldado
--     meta             SIN rastro: 26   <- declarado Meta, sin con que atribuir campana
--     promotor         + rastro : 14    <- ⚠️ CONFLICTO: el lead entro por Meta y se
--                                          marco promotor. Decide 20% a terceros
--                                          contra 16% de marketing (punto #46)
--     otro             + rastro : 4
--     NULL             + rastro : 3
--     sin rastro, resto         : 233
--
--   4 campanas alcanzan negocios: CAMPANA JUNIO 2026 DJ - VIDEO (32),
--   CLIENTES POTENCIALES JUL/AGO 2026 (12), ...AGO 2026 PLUS (11), ...AGO 2026 (1).
--
-- ── La regla que gobierna la salida ───────────────────────────────────────────────
--
-- Sin dato NO es lo mismo que cumplido, y aqui se traduce en TRES estados que la
-- pantalla no puede confundir:
--   · con rastro y con campana  -> se atribuye
--   · con rastro y sin campana  -> "vino de Meta, no se pudo atribuir" (hoy: 0, y el
--     estado existe igual porque un lead nuevo puede llegar sin campana)
--   · sin rastro                -> "sin rastro de Meta". NO se afirma "no vino de
--     Meta": lo unico que se sabe es que no dejo huella en el sistema. Van en raya.
--
-- No escribe datos: agrega columnas a una vista, crea una vista y tres funciones.

-- ============================================================
-- 1. Atribucion por negocio — fuente unica
-- ============================================================
-- Vive en una vista y no dentro de cada RPC para que el drill, el desglose del
-- panel y cualquier consumidor futuro no puedan contradecirse. Es la misma leccion
-- que dejo la formula de saldo escrita en siete sitios.
--
-- `security_invoker` para que respete el RLS de quien consulta; las RPC que la
-- consumen son SECURITY DEFINER y traen su guard por workspace, que es la barrera.

CREATE OR REPLACE VIEW v_negocio_atribucion
WITH (security_invoker = on) AS
SELECT
  n.workspace_id,
  n.id                                        AS negocio_id,
  n.contacto_id,
  -- Lo que alguien DECLARO al crear el negocio. Puede ser NULL.
  n.origen                                    AS origen_declarado,
  -- ¿El contacto dejo rastro de Meta? Es lo unico verificable.
  (i.n_meta > 0)                              AS tiene_rastro_meta,
  i.campana,
  i.primera_conversion,
  i.ultima_conversion,
  COALESCE(i.n_conversiones, 0)               AS n_conversiones,
  -- ⚠️ El origen declarado dice Meta o promotor, pero no hay rastro que lo respalde;
  -- o hay rastro de Meta y el negocio quedo marcado como otra cosa. Se expone para
  -- que la pantalla lo muestre, NO para corregirlo: quien decide la comision es una
  -- persona, y taparlo aqui seria elegir por ella.
  (
    (i.n_meta > 0 AND n.origen IS DISTINCT FROM 'meta')
    OR (n.origen = 'meta' AND COALESCE(i.n_meta, 0) = 0)
  )                                           AS atribucion_en_conflicto
FROM negocios n
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                                                      AS n_conversiones,
    COUNT(*) FILTER (WHERE ci.fuente = 'meta')                    AS n_meta,
    MIN(ci.ocurrida_at)                                           AS primera_conversion,
    MAX(ci.ocurrida_at)                                           AS ultima_conversion,
    -- La campana de la interaccion de Meta MAS RECIENTE que la declara. Si el
    -- contacto volvio a levantar la mano en otra campana, la vigente es la ultima.
    (
      SELECT ci2.payload->>'campaign_name'
      FROM contacto_interacciones ci2
      WHERE ci2.contacto_id = n.contacto_id
        AND ci2.fuente = 'meta'
        AND NULLIF(ci2.payload->>'campaign_name', '') IS NOT NULL
      ORDER BY ci2.ocurrida_at DESC
      LIMIT 1
    )                                                             AS campana
  FROM contacto_interacciones ci
  WHERE ci.contacto_id = n.contacto_id
) i ON true;

COMMENT ON VIEW v_negocio_atribucion IS
  'De donde vino cada negocio: el origen DECLARADO (negocios.origen) junto al RASTRO verificable (contacto_interacciones de Meta) y su campana, mas la fecha de la ultima conversion. Fuente unica del drill comercial y del desglose por origen, para que no puedan contradecirse. atribucion_en_conflicto marca los casos en que lo declarado y el rastro no coinciden: se muestra, no se corrige.';

REVOKE ALL ON v_negocio_atribucion FROM anon, authenticated;
-- server-only: la leen funciones SECURITY DEFINER con guard por workspace.


-- ============================================================
-- 2. La vista de venta expone el contacto y el origen declarado
-- ============================================================
-- ⚠️ `create or replace view` solo admite AGREGAR columnas al final. Por eso las
-- dos nuevas van al final aunque queden lejos de sus parientes.

CREATE OR REPLACE VIEW v_venta_mes_comercial
WITH (security_invoker = on) AS
WITH cobros_neg AS (
  SELECT
    cv.negocio_id,
    cv.workspace_id,
    min(cv.fecha)                                        AS fecha_venta,
    sum(cv.a_tramo1 + cv.a_tramo2)                       AS honorario_recaudado,
    sum(cv.a_tramo1)                                     AS primer_pago,
    sum(cv.a_tramo2)                                     AS segundo_pago,
    sum(cv.a_tarifa)                                     AS tarifa,
    max(cv.fecha) filter (where cv.completa_tramo1 or cv.completa_tramo2) as fecha_honorario_cubierto
  from v_cobro_valor cv
  group by cv.negocio_id, cv.workspace_id
)
select
  n.workspace_id,
  n.id                                                   as negocio_id,
  n.codigo,
  n.nombre,
  n.estado,
  n.created_at,
  vc.comercial_staff_id                                  as responsable_id,
  cn.fecha_venta,
  cn.fecha_honorario_cubierto,
  coalesce(vv.valor_aprobado_total, 0)                   as honorario_con_iva,
  coalesce(vv.valor_aprobado_base, 0)                    as honorario_sin_iva,
  coalesce(cn.honorario_recaudado, 0)                    as honorario_recaudado,
  coalesce(cn.primer_pago, 0)                            as primer_pago,
  coalesce(cn.segundo_pago, 0)                           as segundo_pago,
  coalesce(cn.tarifa, 0)                                 as tarifa,
  (coalesce(cn.honorario_recaudado, 0) >= coalesce(vv.valor_aprobado_total, 0) - 1) as caso_completo,
  n.contacto_id,
  n.origen                                               as origen_declarado
from negocios n
join cobros_neg cn      on cn.negocio_id = n.id and cn.fecha_venta is not null
join v_negocio_valor vv on vv.negocio_id = n.id
left join v_negocio_comercial vc on vc.negocio_id = n.id;

COMMENT ON VIEW v_venta_mes_comercial IS
  'Definicion unica de "venta" del tablero comercial: negocio con al menos un cobro con fecha. '
  'La consumen get_comercial_kpis_mes_soena (la cifra), get_comercial_ventas_mes_soena (su drill) '
  'y get_comercial_origen_mes_soena (el desglose por origen). '
  'server-only: la leen funciones SECURITY DEFINER con guard por workspace.';

REVOKE ALL ON v_venta_mes_comercial FROM anon, authenticated;


-- ============================================================
-- 3. El drill: origen, campana y dos filtros nuevos
-- ============================================================
-- Cambios respecto de 20260812230000:
--   · devuelve `origen_declarado`, `tiene_rastro_meta`, `campana` y el conflicto;
--   · `p_dia` abre las ventas de UN dia (la barra del grafico diario y "mejor dia");
--   · `p_campana` abre las ventas de UNA campana del desglose.
-- La ultima conversion ya venia desde el 2026-08-12 (punto #25 del inventario, que
-- figura abierto y esta cerrado); ahora sale de la vista comun en vez de un CTE
-- propio, que era la unica forma de que el drill y el desglose se separaran.

DROP FUNCTION IF EXISTS public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean);

CREATE OR REPLACE FUNCTION public.get_comercial_ventas_mes_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer,
  p_responsable_id uuid default null,
  p_solo_completos boolean default null,
  p_sin_responsable boolean default false,
  p_dia date default null,
  -- '' (cadena vacia) abre el bucket de los que NO tienen campana atribuida; NULL
  -- significa "todas". Son preguntas distintas y por eso no comparten valor.
  p_campana text default null
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
           a.n_conversiones, a.atribucion_en_conflicto
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
    -- Los tres estados de la atribucion viajan por separado a proposito: la
    -- pantalla tiene que poder distinguir "no dejo rastro" de "vino de Meta y no
    -- se pudo atribuir", y ninguno de los dos es un cero.
    'origen_declarado', v.origen_declarado,
    'tiene_rastro_meta', COALESCE(v.tiene_rastro_meta, false),
    'campana',          v.campana,
    'atribucion_en_conflicto', COALESCE(v.atribucion_en_conflicto, false),
    'valor_sin_iva',    v.honorario_sin_iva,
    'valor_con_iva',    v.honorario_con_iva,
    'recaudado',        v.honorario_recaudado,
    'primer_pago',      v.primer_pago,
    'segundo_pago',     v.segundo_pago,
    'caso_completo',    v.caso_completo,
    'sin_honorario_aprobado', (v.honorario_con_iva = 0)
  ) ORDER BY v.fecha_venta DESC, v.codigo), '[]'::jsonb)
  FROM ventas v
  LEFT JOIN staff s ON s.id = v.responsable_id;
$function$;

COMMENT ON FUNCTION public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean, date, text) IS
  'Drill del tablero comercial: los casos detras de la cifra del mes. Consume v_venta_mes_comercial (la MISMA fuente que la cifra) y v_negocio_atribucion (la MISMA que el desglose por origen), para que ninguna lista pueda contradecir al numero en el que se hizo clic.';

-- ejecutable-por-cliente: la invoca el navegador via server action; filtra por
-- current_user_workspace_id() en su guard, igual que sus hermanas del tablero.
revoke execute on function public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean, date, text) from public, anon;
grant  execute on function public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean, date, text) to authenticated;


-- ============================================================
-- 4. Desglose por origen y campana del mes
-- ============================================================
-- Alimenta la seccion nueva del panel comercial. Cada fila es clicable y abre el
-- drill de arriba con el mismo criterio, asi que la lista y el numero salen de la
-- misma vista.

CREATE OR REPLACE FUNCTION public.get_comercial_origen_mes_soena(
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
    SELECT v.negocio_id, v.honorario_sin_iva, v.honorario_recaudado,
           COALESCE(a.tiene_rastro_meta, false) AS tiene_rastro_meta,
           a.campana,
           v.origen_declarado,
           COALESCE(a.atribucion_en_conflicto, false) AS en_conflicto
    FROM v_venta_mes_comercial v
    JOIN guard g ON v.workspace_id = g.id
    LEFT JOIN v_negocio_atribucion a ON a.negocio_id = v.negocio_id
    WHERE EXTRACT(YEAR  FROM v.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM v.fecha_venta) = p_mes
  )
  SELECT jsonb_build_object(
    'total', (SELECT COUNT(*) FROM ventas),
    -- Cuantas ventas dejaron rastro de Meta. El resto NO se declara "directo":
    -- solo se sabe que no hay huella, y eso es lo que la pantalla dice.
    'con_rastro_meta',  (SELECT COUNT(*) FROM ventas WHERE tiene_rastro_meta),
    'sin_rastro',       (SELECT COUNT(*) FROM ventas WHERE NOT tiene_rastro_meta),
    -- Vino de Meta y aun asi no se le pudo poner campana. Es su propio estado.
    'meta_sin_campana', (SELECT COUNT(*) FROM ventas WHERE tiene_rastro_meta AND campana IS NULL),
    'en_conflicto',     (SELECT COUNT(*) FROM ventas WHERE en_conflicto),
    'por_origen', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'origen')
      FROM (
        SELECT jsonb_build_object(
          'origen',       origen_declarado,
          'ventas',       COUNT(*),
          'valor_sin_iva', COALESCE(SUM(honorario_sin_iva), 0),
          'recaudado',    COALESCE(SUM(honorario_recaudado), 0),
          'con_rastro_meta', COUNT(*) FILTER (WHERE tiene_rastro_meta)
        ) AS x
        FROM ventas
        GROUP BY origen_declarado
      ) t
    ), '[]'::jsonb),
    'por_campana', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'ventas')::int DESC, x->>'campana')
      FROM (
        SELECT jsonb_build_object(
          'campana',      campana,
          'ventas',       COUNT(*),
          'valor_sin_iva', COALESCE(SUM(honorario_sin_iva), 0),
          'recaudado',    COALESCE(SUM(honorario_recaudado), 0)
        ) AS x
        FROM ventas
        WHERE tiene_rastro_meta
        GROUP BY campana
      ) t
    ), '[]'::jsonb)
  );
$function$;

COMMENT ON FUNCTION public.get_comercial_origen_mes_soena(uuid, integer, integer) IS
  'Desglose de las ventas del mes por origen declarado y por campana de Meta. Consume las MISMAS vistas que la cifra y su drill. Distingue tres estados: con campana, con rastro de Meta pero sin campana, y sin rastro (que NO se afirma como "no vino de Meta").';

-- ejecutable-por-cliente: la invoca el navegador via server action; filtra por
-- current_user_workspace_id() en su guard.
revoke execute on function public.get_comercial_origen_mes_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_comercial_origen_mes_soena(uuid, integer, integer) to authenticated;


-- ============================================================
-- 5. Los casos detras de la tasa de cancelacion
-- ============================================================
-- Es la unica cifra del panel que representa un conjunto concreto de casos y no
-- abria nada, porque un negocio perdido puede no tener cobro y entonces NO esta en
-- `v_venta_mes_comercial`. Necesita su propia consulta.
--
-- ⚠️ Usa EXACTAMENTE el mismo criterio que `n_perdidos` de get_comercial_kpis_mes_soena
-- (estado 'perdido' + EXTRACT sobre `updated_at`), incluido su defecto: `updated_at`
-- es timestamptz y EXTRACT lo lee en la zona de la sesion, que aqui es UTC, asi que
-- una perdida registrada despues de las 7 p.m. del ultimo dia del mes cae en el mes
-- siguiente. Se replica a proposito: corregirlo aqui y no alla haria que la lista
-- contradijera al numero. Arreglarlo es un cambio aparte, y mueve la cifra.
--
-- Medido en SOENA el 2026-08-22: 11 perdidos en total (6 en julio, 5 en agosto),
-- con razon fuera_de_perfil 6, duplicado 4, otro 1.

CREATE OR REPLACE FUNCTION public.get_comercial_perdidos_mes_soena(
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
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'negocio_id',   n.id,
    'codigo',       n.codigo,
    'nombre',       n.nombre,
    'responsable',  s.full_name,
    'fecha',        to_char(n.updated_at, 'YYYY-MM-DD'),
    'razon',        n.razon_cierre,
    'detalle',      n.descripcion_cierre,
    'etapa',        e.nombre,
    'origen_declarado', a.origen_declarado,
    'tiene_rastro_meta', COALESCE(a.tiene_rastro_meta, false),
    'campana',      a.campana
  ) ORDER BY n.updated_at DESC, n.codigo), '[]'::jsonb)
  FROM negocios n
  JOIN guard g ON g.id = n.workspace_id
  LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = n.id
  LEFT JOIN staff s                ON s.id = vc.comercial_staff_id
  LEFT JOIN etapas_negocio e       ON e.id = n.etapa_actual_id
  LEFT JOIN v_negocio_atribucion a ON a.negocio_id = n.id
  WHERE n.estado = 'perdido'
    AND EXTRACT(YEAR  FROM n.updated_at) = p_anio
    AND EXTRACT(MONTH FROM n.updated_at) = p_mes;
$function$;

COMMENT ON FUNCTION public.get_comercial_perdidos_mes_soena(uuid, integer, integer) IS
  'Los casos detras de la tasa de cancelacion del mes. Replica el criterio exacto de n_perdidos en get_comercial_kpis_mes_soena, incluido su sesgo de zona horaria, para que la lista no contradiga al numero.';

-- ejecutable-por-cliente: la invoca el navegador via server action; filtra por
-- current_user_workspace_id() en su guard.
revoke execute on function public.get_comercial_perdidos_mes_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_comercial_perdidos_mes_soena(uuid, integer, integer) to authenticated;


-- ============================================================
-- ROLLBACK (comentado):
--   DROP FUNCTION IF EXISTS public.get_comercial_perdidos_mes_soena(uuid, integer, integer);
--   DROP FUNCTION IF EXISTS public.get_comercial_origen_mes_soena(uuid, integer, integer);
--   DROP FUNCTION IF EXISTS public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean, date, text);
--   Re-aplicar la definicion de get_comercial_ventas_mes_soena y de
--   v_venta_mes_comercial de 20260812230000_venta_comercial_una_sola_fuente.sql
--   (⚠️ la vista hay que DROPEARLA antes: quitarle columnas no se puede con
--   create or replace, y arrastra a v_pyl_mes / v_mc_linea_mes si se usa cascade).
--   DROP VIEW IF EXISTS v_negocio_atribucion;
-- ============================================================
