-- Qué es una VENTA del mes: una sola definición, consumida por la cifra y por su drill.
--
-- El tablero comercial dice "30 ventas en agosto" y hasta ahora no había forma de ver
-- cuáles son. Para abrir esa lista hace falta el mismo criterio que produjo el número;
-- si el drill lo reimplementa, muestra una lista que no cuadra con la cifra en la que
-- el usuario hizo clic — el defecto que este repo ya pagó con el ranking de calidad
-- calculado en dos funciones y con la fórmula de saldo escrita en siete sitios.
--
-- Por eso el CTE `ventas_mes` que vivía DENTRO de `get_comercial_kpis_mes_soena` sale a
-- una vista, y las dos funciones la consumen.
--
-- ⚠️ La reescritura de la RPC NO cambia su salida. Verificado con el md5 del jsonb
-- completo para mayo a agosto de 2026, con la sesión simulada (`request.jwt.claims`):
-- sin simular la sesión el guard no resuelve workspace y el md5 sería el del caso
-- VACÍO, o sea comparar dos veces "nada" y leerlo como éxito.
--   mayo 083104bb46391a768236486201144c32 (2 ventas)
--   junio b88b0cb959abaf2df7ecb316907ef9ab (3)
--   julio a27654bdfc9b7b8e387496063561e8de (35)
--   agosto 9fcb69d74dddb9b2db8cb4ba57781bbf (30)

-- ── La definición de venta comercial ────────────────────────────────────────────────
-- `security_invoker` para que la vista respete el RLS de quien consulta. Las dos RPC son
-- SECURITY DEFINER y traen su propio guard por workspace, que es la barrera real.
create or replace view v_venta_mes_comercial
with (security_invoker = on) as
with cobros_neg as (
  -- Recaudo por negocio, ya desglosado por cuenta (tramo 1, tramo 2, tarifa de tercero).
  -- La fecha de la VENTA es la del primer cobro con fecha: el acuerdo se cuenta el día
  -- que entra el dinero, que es la definición que el cliente aprobó ("venta = entró plata").
  select
    cv.negocio_id,
    cv.workspace_id,
    min(cv.fecha)                                        as fecha_venta,
    sum(cv.a_tramo1 + cv.a_tramo2)                       as honorario_recaudado,
    sum(cv.a_tramo1)                                     as primer_pago,
    sum(cv.a_tramo2)                                     as segundo_pago,
    sum(cv.a_tarifa)                                     as tarifa,
    -- Fecha en que el honorario quedó cubierto. NO se inventa un criterio nuevo: se usa
    -- la marca que el modelo de imputación ya calcula sobre el cobro que cierra cada
    -- tramo (`completa_tramo1` / `completa_tramo2`), así que la fecha sale del mismo
    -- sitio que la cifra de casos completos. En plan 100% cierra el tramo 1; en plan
    -- 50/50, el tramo 2.
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
  -- Lo recaudado del honorario llega CON IVA: se compara contra el total, no contra la base.
  (coalesce(cn.honorario_recaudado, 0) >= coalesce(vv.valor_aprobado_total, 0) - 1) as caso_completo
from negocios n
join cobros_neg cn      on cn.negocio_id = n.id and cn.fecha_venta is not null
join v_negocio_valor vv on vv.negocio_id = n.id
left join v_negocio_comercial vc on vc.negocio_id = n.id;

comment on view v_venta_mes_comercial is
  'Definicion unica de "venta" del tablero comercial: negocio con al menos un cobro con fecha. '
  'La consumen get_comercial_kpis_mes_soena (la cifra) y get_comercial_ventas_mes_soena (su drill). '
  'server-only: la leen funciones SECURITY DEFINER con guard por workspace.';

revoke all on v_venta_mes_comercial from anon, authenticated;

-- ── La cifra: misma salida, ahora sobre la vista ────────────────────────────────────
create or replace function public.get_comercial_kpis_mes_soena(p_workspace_id uuid, p_anio integer, p_mes integer)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  ventas_mes AS (
    SELECT v.negocio_id, v.responsable_id, v.fecha_venta,
           v.honorario_con_iva, v.honorario_sin_iva, v.honorario_recaudado,
           v.primer_pago, v.segundo_pago, v.tarifa, v.caso_completo
    FROM v_venta_mes_comercial v, guard g
    WHERE v.workspace_id = g.id
      AND EXTRACT(YEAR  FROM v.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM v.fecha_venta) = p_mes
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
      'tasa_recaudo',         CASE WHEN (SELECT valor_con_iva FROM tot) > 0
                                    THEN round(100.0 * (SELECT honorario_recaudado FROM tot) / (SELECT valor_con_iva FROM tot), 1)
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
$function$;

-- ── El drill: qué casos hay detrás de la cifra ──────────────────────────────────────
-- Mismo periodo y mismo criterio que la cifra, más las fechas que el equipo comercial
-- viene pidiendo desde el 16-jul: cuándo se vendió, cuándo quedó cubierto el honorario,
-- cuándo entró el lead y cuándo fue su última conversión (el último formulario llenado).
create or replace function public.get_comercial_ventas_mes_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer,
  p_responsable_id uuid default null,
  p_solo_completos boolean default null,
  -- El bucket "(sin responsable)" tambien es una fila clicable de la tabla, y no se puede
  -- pedir con `p_responsable_id = null` porque eso ya significa "todos". Necesita su
  -- propia bandera o esa fila seria la unica del tablero que no abre nada.
  p_sin_responsable boolean default false
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
    SELECT v.*
    FROM v_venta_mes_comercial v, guard g
    WHERE v.workspace_id = g.id
      AND EXTRACT(YEAR  FROM v.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM v.fecha_venta) = p_mes
      -- Sin filtro declarado se listan TODOS; con `p_sin_responsable` se abre el bucket
      -- de los que no tienen comercial atribuido.
      AND (CASE WHEN p_sin_responsable THEN v.responsable_id IS NULL
                WHEN p_responsable_id IS NOT NULL THEN v.responsable_id = p_responsable_id
                ELSE true END)
      AND (p_solo_completos IS NULL OR v.caso_completo = p_solo_completos)
  ),
  -- Ultima conversion = la interaccion mas reciente del contacto del negocio. Es lo que
  -- Daniela pide para distinguir "entro hace tres meses" de "acaba de volver a levantar
  -- la mano": 51 negocios del workspace tienen interaccion registrada.
  conversion AS (
    SELECT n.id AS negocio_id, MAX(ci.ocurrida_at) AS ultima_conversion, COUNT(*) AS n_conversiones
    FROM negocios n
    JOIN contacto_interacciones ci ON ci.contacto_id = n.contacto_id
    WHERE n.id IN (SELECT negocio_id FROM ventas)
    GROUP BY n.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'negocio_id',       v.negocio_id,
    'codigo',           v.codigo,
    'nombre',           v.nombre,
    'estado',           v.estado,
    'responsable',      COALESCE(s.full_name, NULL),
    'fecha_venta',      to_char(v.fecha_venta, 'YYYY-MM-DD'),
    -- Solo se declara completado cuando el caso lo esta: mostrar la fecha del ultimo
    -- cobro en un caso que aun debe honorario diria que se cerro algo que sigue abierto.
    'fecha_completado', CASE WHEN v.caso_completo
                             THEN to_char(v.fecha_honorario_cubierto, 'YYYY-MM-DD') END,
    'fecha_creacion',   to_char(v.created_at, 'YYYY-MM-DD'),
    'ultima_conversion', to_char(c.ultima_conversion, 'YYYY-MM-DD'),
    'n_conversiones',   COALESCE(c.n_conversiones, 0),
    'valor_sin_iva',    v.honorario_sin_iva,
    'valor_con_iva',    v.honorario_con_iva,
    'recaudado',        v.honorario_recaudado,
    'primer_pago',      v.primer_pago,
    'segundo_pago',     v.segundo_pago,
    'caso_completo',    v.caso_completo,
    -- ⚠️ HALLAZGO, no defecto de este drill: `caso_completo` compara el recaudo contra el
    -- honorario aprobado, y un caso SIN honorario aprobado compara contra CERO, asi que
    -- entra como completo con solo existir. Medido el 2026-08-12: en agosto son 2 de los
    -- 28 completos (V0306 y V0310); mayo a julio, ninguno. La cifra NO se cambia aqui —
    -- eso es la decision de negocio pendiente sobre que es una venta bonificable— pero el
    -- drill lo marca, para que quien abra la lista vea por que ese caso esta ahi.
    'sin_honorario_aprobado', (v.honorario_con_iva = 0)
  ) ORDER BY v.fecha_venta DESC, v.codigo), '[]'::jsonb)
  FROM ventas v
  LEFT JOIN staff s      ON s.id = v.responsable_id
  LEFT JOIN conversion c ON c.negocio_id = v.negocio_id;
$function$;

comment on function public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean) is
  'Drill del tablero comercial: los casos detras de la cifra del mes. Consume '
  'v_venta_mes_comercial, la MISMA fuente que get_comercial_kpis_mes_soena, para que la '
  'lista no pueda contradecir al numero en el que se hizo clic.';

-- ejecutable-por-cliente: la invoca el navegador via server action; filtra por
-- current_user_workspace_id() en su guard, igual que sus hermanas del tablero.
revoke execute on function public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean) from public, anon;
grant  execute on function public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean) to authenticated;
