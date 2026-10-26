-- Dry-run de 20261008193000_segundo_pago_sobrantes_soena.sql (SOE-002, segunda parte)
-- contra produccion.
--
-- UN solo statement: crea la funcion, simula la sesion de una admin de SOENA, cruza la
-- serie viva con los sobrantes y aborta con RAISE EXCEPTION. Nada queda escrito: el
-- resultado vuelve en el mensaje del error. Correrlo por MCP execute_sql y despues
-- confirmar que la funcion NO existe:
--   select count(*) from pg_proc where proname = 'get_segundo_pago_sobrantes_soena';  -- 0
--
-- Lo que tiene que decir (lectura de v_cobro_valor del 2026-10-08):
--   sobrantes: 3 (2026-07-22 $10,08 · 2026-09-04 $3,36 · 2026-09-16 $28,57)
--   2026-07  serie_viva 1428581.52  sin_sobrantes 1428571.44
--   2026-09  serie_viva 2053117.65  sin_sobrantes 2053085.72
-- y, como control, `sin_sobrantes` de cada mes tiene que ser IGUAL a
-- `get_segundo_pago_mes_soena(...)->recibido->total` (la cifra del panel): `cuadra` = true
-- en los seis meses. Si alguno da false, la serie viva no suma lo que dice el repo.
--
-- El cuerpo de la migracion va pegado TAL CUAL entre $mig$ (generado con cat, no
-- transcrito). Si se edita la migracion, regenerar este archivo.

DO $dry$
DECLARE
  ws  uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  uid uuid;
  s   jsonb;
  serie jsonb;
  pt  jsonb;
  quita numeric;
  limpio numeric;
  panel numeric;
  r   jsonb := '{}'::jsonb;
BEGIN
  EXECUTE $mig$
-- ============================================================
-- 20261008193000_segundo_pago_sobrantes_soena
-- ============================================================
-- SOE-002, segunda parte. La gráfica «Primer vs segundo pago recibido por mes» del
-- Comercial (`get_comercial_serie_mensual_soena`, y sus gemelas por vendedor y por
-- seccional) suma TODO abono a tramo 2 con fecha de pago en el mes, también los
-- sobrantes de centavos que la imputación de `v_cobro_valor` manda a tramo 2 cuando un
-- pago excede por unos pesos el techo del primer tramo + la tarifa UPME. La cifra
-- «2º pago recibido este mes» (`get_segundo_pago_mes_soena`, 20261008163000) ya los
-- descarta con el umbral de $1.000 por cobro; la barra de ese mismo mes no, y decían
-- dos cosas distintas con el mismo nombre.
--
-- Esta migración NO reescribe las tres series vivas: divergen del repo (fueron
-- reescritas en producción por reemplazo de texto, ver 20260927000001 y el
-- encabezado de 20261008163000). Crea UNA función nueva que devuelve la lista de esos
-- sobrantes, cobro por cobro, y la pantalla los resta de la barra: del total por mes, y
-- de la serie por vendedor y por seccional por `cobro_ids`, que ya viajan en cada punto.
-- Así la barra filtrada sigue sumando la barra total.
--
-- Mismo criterio y misma constante que `get_segundo_pago_mes_soena`: un abono a tramo 2
-- (sin IVA) menor a $1.000 es sobrante, no segundo pago. La constante vive en el CTE
-- `parametros` de las dos funciones y viaja en la respuesta (`umbral_migaja`); si se
-- cambia, se cambia en las dos.
--
-- ⚠️ NO cambia la imputación de `v_cobro_valor` (la usan la conciliación, los recibos
-- Siigo y la imputación UPME). El sobrante sigue entrando al RECAUDO del mes, que es
-- plata que sí entró; solo deja de pintarse como segundo pago.
--
-- Medido en producción el 2026-10-08 (lectura de `v_cobro_valor`, 26 cobros con tramo 2):
--   2026-07-22  V0103  $10,08
--   2026-09-04  V0447  $3,36
--   2026-09-16  V0294  $28,57
-- Barra de julio $1.428.581,52 -> $1.428.571,44; septiembre $2.053.117,65 -> $2.053.085,72.
-- Ensayo en `sql/soena/2026-10-08_dry-run_segundo-pago-sobrantes.sql`.
--
-- No crea tablas ni vistas y no toca un solo dato.
-- ============================================================

create or replace function public.get_segundo_pago_sobrantes_soena(p_workspace_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with guard as (
    select p_workspace_id as id
    where p_workspace_id = current_user_workspace_id()
  ),
  -- La misma constante que `get_segundo_pago_mes_soena`. Ver el encabezado.
  parametros as (
    select 1000::numeric as umbral_migaja
  ),
  sobrantes as (
    select cv.cobro_id, cv.negocio_id, n.codigo, cv.fecha, cv.a_tramo2_base as valor
    from v_cobro_valor cv
    join guard g on cv.workspace_id = g.id
    cross join parametros p
    left join negocios n on n.id = cv.negocio_id
    where cv.fecha is not null
      and cv.a_tramo2_base > 0
      and cv.a_tramo2_base < p.umbral_migaja
  )
  select jsonb_build_object(
    'umbral_migaja', (select umbral_migaja from parametros),
    'sobrantes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'cobro_id',   s.cobro_id,
        'negocio_id', s.negocio_id,
        'codigo',     s.codigo,
        'fecha',      to_char(s.fecha, 'YYYY-MM-DD'),
        'anio',       extract(year  from s.fecha)::int,
        'mes',        extract(month from s.fecha)::int,
        'valor',      s.valor
      ) order by s.fecha, s.cobro_id)
      from sobrantes s), '[]'::jsonb)
  )
  where exists (select 1 from guard);
$function$;

comment on function public.get_segundo_pago_sobrantes_soena(uuid) is
  'SOE-002. Abonos a tramo 2 (sin IVA) menores a `umbral_migaja`: sobrantes de redondeo '
  'que la imputacion de v_cobro_valor manda a tramo 2. La serie «Primer vs segundo pago '
  'recibido por mes» los resta de su barra de segundo pago, con el mismo criterio que '
  'get_segundo_pago_mes_soena. No cambia la imputacion.';

-- ejecutable-por-cliente: la llama la página de Tableros con la sesión del usuario; la
-- propia función filtra por current_user_workspace_id() (guard).
revoke execute on function public.get_segundo_pago_sobrantes_soena(uuid) from public, anon;
grant  execute on function public.get_segundo_pago_sobrantes_soena(uuid) to authenticated;
$mig$;

  SELECT p.id INTO uid
  FROM profiles p
  WHERE p.workspace_id = ws AND p.role IN ('owner', 'admin')
  ORDER BY p.role DESC
  LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  IF current_user_workspace_id() IS DISTINCT FROM ws THEN
    RAISE EXCEPTION 'DRYRUN la sesion simulada no resuelve SOENA (uid %): el ensayo no prueba nada', uid;
  END IF;

  s := public.get_segundo_pago_sobrantes_soena(ws);
  serie := public.get_comercial_serie_mensual_soena(ws, 12);
  r := jsonb_build_object('umbral', s->'umbral_migaja', 'sobrantes', s->'sobrantes');

  FOR pt IN SELECT * FROM jsonb_array_elements(serie->'serie') LOOP
    IF (pt->>'anio')::int = 2026 AND (pt->>'mes')::int BETWEEN 4 AND 9 THEN
      SELECT coalesce(sum((x->>'valor')::numeric), 0) INTO quita
      FROM jsonb_array_elements(s->'sobrantes') x
      WHERE (x->>'anio')::int = (pt->>'anio')::int AND (x->>'mes')::int = (pt->>'mes')::int;
      limpio := greatest(0, (pt->>'segundo_pago')::numeric - quita);
      panel := (public.get_segundo_pago_mes_soena(ws, (pt->>'anio')::int, (pt->>'mes')::int)->'recibido'->>'total')::numeric;
      r := r || jsonb_build_object((pt->>'anio') || '-' || lpad(pt->>'mes', 2, '0'), jsonb_build_object(
        'serie_viva',     (pt->>'segundo_pago')::numeric,
        'sin_sobrantes',  limpio,
        'panel_recibido', panel,
        'cuadra',         round(limpio, 2) = round(panel, 2)
      ));
    END IF;
  END LOOP;

  RAISE EXCEPTION 'DRYRUN %', jsonb_pretty(r);
END $dry$;
