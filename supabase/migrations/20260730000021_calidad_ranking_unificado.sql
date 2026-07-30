-- Se paga la deuda: el ranking de calidad pasa a calcularse en UN solo sitio.
--
-- Desde la v6 el muro calculaba su propio ranking en linea dentro de
-- `calidad_bloque_periodo`, mientras `get_calidad_equipo` delegaba en
-- `calidad_ranking_periodo`. Dos copias de la misma logica. Hoy dan lo mismo,
-- pero nada lo garantizaba: el proximo cambio a una de las dos las separa en
-- silencio, y la contradiccion se descubre cuando dos pantallas del mismo
-- equipo muestran numeros distintos. Ver la deuda documentada en el #157.
--
-- Esta migracion NO agrega la columna de recaudado. Ese es el cambio que
-- destapo la deuda, y va en la migracion siguiente, ya sobre una sola fuente.
--
-- ── El bug que se arregla de paso: la clave de agrupacion ───────────────────
--
-- Las dos implementaciones agrupaban por el TEXTO del nombre: el muro por el
-- primer nombre (`split_part(agente_nombre, ' ', 1)`), la vista de equipo por
-- el nombre completo. Con los 4 agentes sembrados de hoy eso da igual, porque
-- los 4 tienen primer nombre distinto. Con los ~80 vendedores reales de Advise
-- no: dos "Andres" se fusionan en UNA fila en el muro publico y aparecen como
-- dos en la vista del supervisor. Es la contradiccion que la deuda buscaba
-- evitar, entrando por otra puerta.
--
-- La clave pasa a ser la identidad real, `agente_staff_id`, con el nombre como
-- respaldo cuando no hay id. El nombre queda para MOSTRAR, no para agrupar.
--
-- Verificado antes de escribir esto (2026-07-29): ningun agente tiene llamadas
-- partidas entre filas con id y filas sin id — cada `agente_nombre` las tiene
-- todas con id o todas sin. Por eso el coalesce no parte a nadie y la salida no
-- se mueve. Riesgo residual conocido: si la ingesta empieza a dejar el
-- `agente_staff_id` en null para un agente que si lo tenia, ese agente se
-- partiria en dos filas. Eso seria un defecto de ingesta, y se veria.
--
-- ── Desambiguacion de la etiqueta en el muro ────────────────────────────────
--
-- Separar a los homonimos en dos filas no sirve de nada si el muro publico
-- pinta "Andres" dos veces. La etiqueta escala solo cuando hace falta:
--   sin colision           -> "Andres"
--   colision de nombre     -> "Andres V."
--   colision tambien ahi   -> "Andres Villamil"
-- Sin colision el texto es identico al de hoy, que es lo que mantiene la salida
-- byte a byte igual en los dos workspaces vivos.

-- ── 1. La unica fuente del ranking ──────────────────────────────────────────
create or replace function public.calidad_ranking_periodo(
  p_workspace_id   uuid,
  p_desde          date,
  p_hasta          date,
  p_nombre_completo boolean default false
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with base as (
    select
      l.id,
      -- Identidad, no texto. El nombre es etiqueta.
      coalesce(l.agente_staff_id::text, l.agente_nombre) as clave,
      l.agente_nombre,
      l.puntaje_tecnico,
      l.cerro_venta
    from calidad_llamadas l
    where l.workspace_id = p_workspace_id
      and (l.fecha_hora at time zone 'America/Bogota')::date between p_desde and p_hasta
  ),
  criticas as (
    select b.clave, count(*) as n
    from calidad_llamadas_hallazgos h
    join base b on b.id = h.llamada_id
    where h.eje = 'cumplimiento' and h.severidad = 'critica'
    group by 1
  ),
  agg as (
    select
      b.clave,
      min(b.agente_nombre)                       as nombre,
      count(*)                                   as llamadas,
      count(*) filter (where b.cerro_venta)      as cierres,
      round(avg(b.puntaje_tecnico))::int         as tecnica,
      coalesce(max(c.n), 0)::int                 as banderas
    from base b
    left join criticas c on c.clave = b.clave
    group by b.clave
  ),
  -- Etiqueta progresiva: solo se alarga cuando hay con quien confundirse.
  partes as (
    select
      a.*,
      split_part(a.nombre, ' ', 1)             as n1,
      nullif(split_part(a.nombre, ' ', 2), '') as ap
    from agg a
  ),
  colision_nombre as (
    select p.*, count(*) over (partition by p.n1) as choca_n1
    from partes p
  ),
  con_inicial as (
    select
      c.*,
      case when c.choca_n1 = 1 or c.ap is null then c.n1
           else c.n1 || ' ' || left(c.ap, 1) || '.' end as corto
    from colision_nombre c
  ),
  colision_inicial as (
    select i.*, count(*) over (partition by i.corto) as choca_corto
    from con_inicial i
  ),
  filas as (
    select
      case
        when p_nombre_completo     then f.nombre
        when f.choca_corto = 1     then f.corto
        when f.ap is not null      then f.n1 || ' ' || f.ap
        else f.nombre
      end as agente,
      f.llamadas,
      f.cierres,
      f.tecnica,
      f.banderas
    from colision_inicial f
  ),
  umbrales as (
    select
      percentile_cont(0.33) within group (order by tecnica)  as tecnica_baja,
      percentile_cont(0.67) within group (order by tecnica)  as tecnica_alta,
      percentile_cont(0.33) within group (order by banderas) as banderas_baja,
      percentile_cont(0.67) within group (order by banderas) as banderas_alta
    from filas
  )
  select jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'filas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'agente',    agente,
          'llamadas',  llamadas,
          'cierres',   cierres,
          'pctCierre', case when llamadas > 0 then round(100.0 * cierres / llamadas) else 0 end,
          'tecnica',   tecnica,
          'banderas',  banderas
        )
        order by cierres desc, llamadas desc, agente
      ) from filas
    ), '[]'::jsonb),
    'umbrales', (
      select jsonb_build_object(
        'tecnicaBaja',  tecnica_baja,
        'tecnicaAlta',  tecnica_alta,
        'banderasBaja', banderas_baja,
        'banderasAlta', banderas_alta
      ) from umbrales
    )
  );
$function$;

-- ── 2. El muro deja de calcular lo suyo y delega ────────────────────────────
--
-- Se van los bloques `criticas`, `agg` y `umbrales`: eran la copia. `base` se
-- queda porque `cierres` y `banderaTop` si la usan.
--
-- La forma de la salida NO cambia: `ranking` sigue siendo un objeto con `filas`
-- y `umbrales`, que es lo que lee `RankingPeriodo` en types.ts. Se proyectan
-- esas dos claves de la funcion en vez de pasar su objeto entero, para no
-- colar `desde`/`hasta` dentro de `ranking` y cambiarle la forma a un consumidor
-- que ya esta en produccion.
create or replace function public.calidad_bloque_periodo(
  p_workspace_id uuid,
  p_desde        date,
  p_hasta        date
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with base as (
    select
      l.id,
      l.puntaje_tecnico,
      l.cerro_venta,
      l.forma_pago,
      l.monto_usd
    from calidad_llamadas l
    where l.workspace_id = p_workspace_id
      and (l.fecha_hora at time zone 'America/Bogota')::date between p_desde and p_hasta
  )
  select jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'cierres', (
      select jsonb_build_object(
        'total',    count(*) filter (where cerro_venta),
        'montoUsd', coalesce(sum(monto_usd) filter (where cerro_venta), 0),
        'llamadas', count(*),
        'pctCierre', case when count(*) > 0
                          then round(100.0 * count(*) filter (where cerro_venta) / count(*))
                          else 0 end,
        'montoUnitarioUsd', coalesce(max(monto_usd) filter (where cerro_venta), 0),
        'tarjeta', jsonb_build_object(
          'n',        count(*) filter (where cerro_venta and forma_pago = 'tarjeta'),
          'montoUsd', coalesce(sum(monto_usd) filter (where cerro_venta and forma_pago = 'tarjeta'), 0)
        ),
        'cuenta', jsonb_build_object(
          'n',        count(*) filter (where cerro_venta and forma_pago = 'cuenta'),
          'montoUsd', coalesce(sum(monto_usd) filter (where cerro_venta and forma_pago = 'cuenta'), 0),
          -- Lo que ENTRA de la primera cuota, no el sexto aritmetico. Sale de
          -- la misma funcion que reparte en la vista de dueño.
          'primeraCuotaUsd',
            (calidad_reparto_cuotas(p_workspace_id, p_desde, p_hasta) -> 'aCuotas' ->> 'primeraCuotaUsd')::numeric
        )
      ) from base
    ),
    'cobertura', (
      select jsonb_build_object(
        'recibidas', coalesce(sum(recibidas), 0),
        'auditadas', coalesce(sum(auditadas), 0),
        'baseline',  coalesce(sum(baseline_manual), 0),
        'pct', case when coalesce(sum(recibidas), 0) > 0
                    then round(100.0 * sum(auditadas) / sum(recibidas)) else 0 end
      )
      from calidad_cobertura_dia c
      where c.workspace_id = p_workspace_id and c.fecha between p_desde and p_hasta
    ),
    'banderaTop', (
      select jsonb_build_object('codigo', h.codigo, 'titulo', min(h.titulo), 'veces', count(*))
      from calidad_llamadas_hallazgos h
      join base b on b.id = h.llamada_id
      where h.eje = 'cumplimiento' and h.codigo is not null
      group by h.codigo
      order by count(*) desc, h.codigo
      limit 1
    ),
    -- UNA sola fuente. Si esto vuelve a calcularse aqui, la deuda regresa.
    'ranking', (
      select jsonb_build_object('filas', r.x -> 'filas', 'umbrales', r.x -> 'umbrales')
      from (select calidad_ranking_periodo(p_workspace_id, p_desde, p_hasta, false) as x) r
    )
  );
$function$;
