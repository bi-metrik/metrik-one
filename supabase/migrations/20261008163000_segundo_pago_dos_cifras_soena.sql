-- ============================================================
-- 20261008163000_segundo_pago_dos_cifras_soena
-- ============================================================
-- SOE-002 (Daniela, SOENA): "segundo pago" en los dos tableros medía dos cosas
-- distintas sin decirlo.
--
--   Dirección  · `get_directivo_soena`, CTE `pagos`: tramo 2 de `v_cobro_valor` con
--                FECHA DE PAGO en el mes (caja), de ventas de cualquier mes.
--   Comercial  · `get_comercial_kpis_mes_soena` -> `v_venta_mes_comercial.segundo_pago`:
--                tramo 2 cobrado cuando sea, de las ventas cuyo MES DE VENTA es este
--                (cohorte).
--
-- Septiembre de 2026: Dirección $2.053.118 (7 negocios), Comercial $29 (1 negocio). Y los
-- $29 no son un segundo pago: V0294 pagó $34 más que el techo de primer tramo + tarifa
-- UPME y el sobrante cae, por imputación, en tramo 2. Igual V0103 ($10,08, 22-jul) y
-- V0447 ($3,36, 4-sep). Son centavos de redondeo, no la segunda mitad del 50/50.
--
-- Esta migración NO toca nada que exista. Crea UNA función nueva que devuelve las dos
-- cifras, con nombre propio y con la lista de negocios detrás de cada una, y los dos
-- tableros pasan a leerla:
--
--   recibido           "2º pago recibido este mes": tramo 2 con fecha de pago en el mes,
--                      de cualquier venta, partido en ventas de este mes / de meses
--                      anteriores. Es la cifra de caja de Dirección.
--   de_ventas_del_mes  "2º pago de las ventas de este mes": tramo 2 acumulado (pagado
--                      cuando sea) de las ventas cuyo mes de venta es este. Es la cifra
--                      de cohorte del Comercial. Una venta de julio que paga su segunda
--                      mitad en octubre suma en JULIO.
--
-- Por qué una función nueva y no reescribir las vivas: `get_directivo_soena` ya fue
-- reescrita en producción por reemplazo de texto (20261007184500) y las RPC del
-- Comercial divergen del repo en más de un caso (ver 20261001140200). Reescribirlas desde
-- este repo podría revertir en silencio cambios vivos. Las vivas siguen devolviendo lo
-- mismo; la pantalla deja de leer de ellas estas dos cifras.
--
-- ⚠️ NO cambia la imputación de `v_cobro_valor`: la usan la conciliación, los recibos
-- Siigo y la imputación UPME. Esto es lectura y presentación. El sobrante de centavos
-- sigue imputado a tramo 2 donde se imputa hoy; solo deja de CONTARSE como segundo pago.
--
-- ── Umbral de migajas ($1.000, sin IVA) ──
-- Un negocio cuyo tramo 2 es menor a $1.000 no es un segundo pago. Se aplica:
--   · en `recibido`, por COBRO: un abono a tramo 2 menor a $1.000 no cuenta. V0447 entra
--     en septiembre por su pago real del 18-sep, no por los $3,36 del 4-sep.
--   · en `de_ventas_del_mes`, por NEGOCIO: el tramo 2 ACUMULADO del negocio. V0103 sigue
--     contando en julio (acumula $357.143: su pago real fue el 1-sep).
-- El punto de corte: las migajas medidas son de $3 a $29 y el segundo pago real más chico
-- es de $267.385 (un 75 % de la mitad, 11-sep). $1.000 deja dos órdenes de magnitud de
-- margen hacia cada lado. Vive en UN sitio (el CTE `parametros`) y viaja en la respuesta
-- (`umbral_migaja`) para que la pantalla lo cite sin copiarlo.
--
-- Solo ventas 50/50 (plan 1), sin filtrarlo aquí: `v_negocio_valor.techo_tramo2` vale 0
-- en plan 2 y NULL sin plan declarado, así que fuera del plan 1 el tramo 2 no recibe un
-- peso (salvo el sobrante que el umbral descarta).
--
-- Cifras esperadas (SOENA, sin umbral -> con umbral), del brief del 2026-10-08:
--   mes       recibido                          de_ventas_del_mes
--   2026-06   $3.571.429 (10)                   $0
--   2026-07   $1.428.582 (5) -> $1.428.571 (4)  $1.071.429 (3)
--   2026-08   $0                                $1.338.813 (4)
--   2026-09   $2.053.118 (7) -> $2.053.086 (6)  $29 (1) -> $0
-- El `recibido` se recalculó contra producción (lectura de `v_cobro_valor`, 26 cobros
-- con tramo 2) y cuadra al peso. El ensayo con la sesión simulada está en
-- `sql/soena/2026-10-08_dry-run_segundo_pago_dos_cifras.sql`.
--
-- No crea tablas ni vistas y no toca un solo dato.
-- ============================================================

create or replace function public.get_segundo_pago_mes_soena(p_workspace_id uuid, p_anio integer, p_mes integer)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with guard as (
    select p_workspace_id as id
    where p_workspace_id = current_user_workspace_id()
  ),
  -- La constante con nombre. Abono a tramo 2 (sin IVA) por debajo de esto = sobrante
  -- de redondeo, no segundo pago. Ver el encabezado de la migración.
  parametros as (
    select 1000::numeric as umbral_migaja
  ),
  rango as (
    select make_date(p_anio, p_mes, 1) as desde,
           (make_date(p_anio, p_mes, 1) + interval '1 month')::date as hasta,
           (make_date(p_anio, p_mes, 1) - interval '1 month')::date as desde_anterior
  ),
  -- Las ventas del workspace con su mes de venta y su tramo 2 acumulado.
  -- OFFSET 0 = barrera de optimizacion A PROPOSITO (no limpiar): sin ella el planner subestima filas (fecha_venta es calculada) y re-ejecuta la vista una vez por fila.
  ventas as (
    select v.negocio_id, v.codigo, v.nombre, v.fecha_venta::date as fecha_venta,
           v.segundo_pago, v.responsable_id
    from (select * from v_venta_mes_comercial where workspace_id = p_workspace_id offset 0) v
    join guard g on v.workspace_id = g.id
  ),
  -- Cada abono a tramo 2, en base (sin IVA). Misma columna que suman hoy Dirección y
  -- la serie mensual.
  abonos as (
    select cv.negocio_id, cv.fecha, cv.a_tramo2_base as valor
    from v_cobro_valor cv
    join guard g on cv.workspace_id = g.id
    where cv.a_tramo2_base > 0
  ),
  -- ── Cifra 1: recibido en el mes (caja). Umbral por COBRO. ──
  recibido_neg as (
    select a.negocio_id, sum(a.valor) as valor, max(a.fecha) as fecha_pago
    from abonos a, rango r, parametros p
    where a.fecha >= r.desde and a.fecha < r.hasta
      and a.valor >= p.umbral_migaja
    group by a.negocio_id
  ),
  recibido_det as (
    select rn.negocio_id, n.codigo, n.nombre, v.fecha_venta, rn.fecha_pago, rn.valor,
           v.responsable_id, s.full_name as responsable,
           coalesce(v.fecha_venta >= r.desde, false) as de_venta_del_mes
    from recibido_neg rn
    cross join rango r
    join negocios n on n.id = rn.negocio_id
    left join ventas v on v.negocio_id = rn.negocio_id
    left join staff s on s.id = v.responsable_id
  ),
  -- ── Cifra 2: de las ventas del mes (cohorte). Umbral por NEGOCIO, sobre el acumulado. ──
  cohorte_det as (
    select v.negocio_id, v.codigo, v.nombre, v.fecha_venta, v.segundo_pago as valor,
           v.responsable_id, s.full_name as responsable,
           (select coalesce(max(a.fecha) filter (where a.valor >= p.umbral_migaja), max(a.fecha))
              from abonos a where a.negocio_id = v.negocio_id) as fecha_pago
    from ventas v
    cross join rango r
    cross join parametros p
    left join staff s on s.id = v.responsable_id
    where v.fecha_venta >= r.desde and v.fecha_venta < r.hasta
      and v.segundo_pago >= p.umbral_migaja
  )
  select jsonb_build_object(
    'anio', p_anio,
    'mes', p_mes,
    'umbral_migaja', (select umbral_migaja from parametros),
    'recibido', jsonb_build_object(
      'total',                coalesce((select sum(valor) from recibido_det), 0),
      'negocios',             (select count(*) from recibido_det),
      'de_ventas_del_mes',    coalesce((select sum(valor) from recibido_det where de_venta_del_mes), 0),
      'de_ventas_anteriores', coalesce((select sum(valor) from recibido_det where not de_venta_del_mes), 0),
      'detalle', coalesce((
        select jsonb_agg(jsonb_build_object(
          'negocio_id',       d.negocio_id,
          'codigo',           d.codigo,
          'nombre',           d.nombre,
          'fecha_venta',      to_char(d.fecha_venta, 'YYYY-MM-DD'),
          'fecha_pago',       to_char(d.fecha_pago, 'YYYY-MM-DD'),
          'valor',            d.valor,
          'responsable_id',   d.responsable_id,
          'responsable',      d.responsable,
          'de_venta_del_mes', d.de_venta_del_mes
        ) order by d.fecha_pago desc, d.codigo)
        from recibido_det d), '[]'::jsonb)
    ),
    'de_ventas_del_mes', jsonb_build_object(
      'total',    coalesce((select sum(valor) from cohorte_det), 0),
      'negocios', (select count(*) from cohorte_det),
      'detalle', coalesce((
        select jsonb_agg(jsonb_build_object(
          'negocio_id',       d.negocio_id,
          'codigo',           d.codigo,
          'nombre',           d.nombre,
          'fecha_venta',      to_char(d.fecha_venta, 'YYYY-MM-DD'),
          'fecha_pago',       to_char(d.fecha_pago, 'YYYY-MM-DD'),
          'valor',            d.valor,
          'responsable_id',   d.responsable_id,
          'responsable',      d.responsable,
          'de_venta_del_mes', true
        ) order by d.fecha_pago desc nulls last, d.codigo)
        from cohorte_det d), '[]'::jsonb)
    ),
    -- Los dos totales del mes anterior, con el mismo criterio, para la comparación del
    -- panel. Van aquí para no disparar otra RPC por apertura.
    'anterior', jsonb_build_object(
      'recibido', coalesce((
        select sum(a.valor) from abonos a, rango r, parametros p
        where a.fecha >= r.desde_anterior and a.fecha < r.desde
          and a.valor >= p.umbral_migaja), 0),
      'de_ventas_del_mes', coalesce((
        select sum(v.segundo_pago) from ventas v, rango r, parametros p
        where v.fecha_venta >= r.desde_anterior and v.fecha_venta < r.desde
          and v.segundo_pago >= p.umbral_migaja), 0)
    )
  )
  where exists (select 1 from guard);
$function$;

comment on function public.get_segundo_pago_mes_soena(uuid, integer, integer) is
  'SOE-002. Las dos cifras de segundo pago de los tableros de SOENA, con su lista: '
  '`recibido` (tramo 2 con fecha de pago en el mes, de cualquier venta; umbral por cobro) '
  'y `de_ventas_del_mes` (tramo 2 acumulado de las ventas cuyo mes de venta es este; '
  'umbral por negocio). Todo en base, sin IVA. Abonos a tramo 2 menores a `umbral_migaja` '
  'son sobrante de redondeo y no cuentan. No cambia la imputacion de v_cobro_valor.';

-- ejecutable-por-cliente: la llaman las server actions de Tableros con la sesion del
-- usuario; la propia funcion filtra por current_user_workspace_id() (guard).
revoke execute on function public.get_segundo_pago_mes_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_segundo_pago_mes_soena(uuid, integer, integer) to authenticated;
