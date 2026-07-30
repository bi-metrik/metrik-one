-- La columna que destapo la deuda: recaudado por agente en el ranking.
--
-- Va DESPUES de `20260730000021_calidad_ranking_unificado.sql` y no antes. Con
-- el ranking calculado en dos sitios, agregar esta columna a uno solo era
-- separar las dos copias en silencio. Ahora hay una sola funcion y la columna
-- entra en un solo lugar.
--
-- ── Que es "recaudado", exactamente ─────────────────────────────────────────
--
-- Definido por Mauricio: lo que el cliente YA pago al cerrar la venta.
--   tarjeta -> entra por su monto completo, se cobro de una
--   cuenta   -> entra solo por la PRIMERA de las seis cuotas
-- No es lo vendido. Un mes puede vender mucho y recaudar poco si casi todo
-- entro a cuotas, y esa diferencia es justo lo que la columna hace visible.
--
-- ⚠️ OJO CON EL NOMBRE. Ya existe un `recaudadoUsd` en `calidad_reparto_cuotas`
-- y NO es esto: aquel suma la tarjeta mas la proyeccion de las SEIS cuotas
-- descontada por la tasa de caida, o sea el recaudo estimado del ciclo
-- completo. Este es lo ya cobrado. Mismo nombre, dos preguntas distintas: aquel
-- responde "cuanto va a entrar de esta cohorte", este "cuanto entro por este
-- agente". No se deben sumar ni comparar entre si.
--
-- Y por eso la primera cuota entra SIN descontar la tasa de caida, a diferencia
-- del `primeraCuotaUsd` que pinta el muro en el bloque de cierres: la caida
-- proyecta lo que se perdera de aqui en adelante, no toca lo que ya se cobro.
-- Ademas la tasa es global del workspace, no por agente: aplicarla aqui
-- repartiria entre personas una perdida que no se midio por persona.
--
-- Se AMPLIA la funcion, no se le cambia la forma: `recaudadoUsd` es una clave
-- nueva dentro de cada fila. El consumidor que hoy esta en produccion no la
-- lee y sigue funcionando igual.

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
      coalesce(l.agente_staff_id::text, l.agente_nombre) as clave,
      l.agente_nombre,
      l.puntaje_tecnico,
      l.cerro_venta,
      l.forma_pago,
      l.monto_usd
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
      coalesce(max(c.n), 0)::int                 as banderas,
      -- Tarjeta completa + la primera de seis. Lo ya cobrado.
      round(
        coalesce(sum(b.monto_usd) filter (where b.cerro_venta and b.forma_pago = 'tarjeta'), 0)
        + coalesce(sum(b.monto_usd) filter (where b.cerro_venta and b.forma_pago = 'cuenta'), 0) / 6.0
      , 2)                                       as recaudado_usd
    from base b
    left join criticas c on c.clave = b.clave
    group by b.clave
  ),
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
      f.banderas,
      f.recaudado_usd
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
          'agente',       agente,
          'llamadas',     llamadas,
          'cierres',      cierres,
          'pctCierre',    case when llamadas > 0 then round(100.0 * cierres / llamadas) else 0 end,
          'tecnica',      tecnica,
          'banderas',     banderas,
          'recaudadoUsd', recaudado_usd
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
