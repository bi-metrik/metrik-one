-- La lista de llamadas, en una sola consulta y sin mentir.
--
-- QUE ARREGLA
--
-- 1. LA COLUMNA DE BANDERAS SALIA VACIA. El codigo traia las filas y despues
--    pedia los hallazgos con `.in('llamada_id', [...1000 ids])`. Esa URL pesa
--    ~37 KB y PostgREST la rechaza; el error se tragaba en silencio y TODAS las
--    filas mostraban "—", incluida la llamada real que tiene seis banderas.
--    Comprobado, no inferido: la misma consulta responde con 300 ids (URL ~11 KB)
--    y falla de 441 en adelante (~16 KB). La solucion no es subir el tope: es no
--    mandar nunca una lista de ids. Los codigos salen agregados aqui, en la
--    misma fila, y el problema deja de existir a cualquier volumen.
--
-- 2. LA PANTALLA MOSTRABA EL FUTURO. La historia esta sembrada hasta el dia de
--    la presentacion, asi que la lista abria con llamadas del 31 mientras su
--    propio encabezado decia 28. El muro ya cortaba en la fecha actual; esta
--    pantalla no. Ahora cortan igual, porque que una diga una cosa y la otra
--    otra es lo primero que nota un dueño.
--
-- 3. EL KPI DECIA "1000 · AUDITADAS HOY" Y ERA FALSO DOS VECES. Ni eran 1000
--    (es el tope por defecto de PostgREST, hay 2.817) ni eran de hoy (son 30
--    dias). Peor: los otros tres KPIs se calculaban sobre ese recorte arbitrario.
--    Ahora los KPIs se calculan sobre el periodo COMPLETO y las filas se topan
--    aparte, con el tope declarado (`total` y `mostradas`) para que la pantalla
--    pueda decir cuantas esta enseñando de cuantas.
create or replace function public.get_calidad_lista(
  p_workspace_id uuid,
  p_staff_id     uuid    default null,  -- ejecutor: solo sus llamadas
  p_dias         integer default 30,
  p_limite       integer default 300
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with rango as (
    select
      (now() at time zone 'America/Bogota')::date                       as hasta,
      (now() at time zone 'America/Bogota')::date - (p_dias - 1)        as desde
  ),
  base as (
    select l.*
    from calidad_llamadas l, rango r
    where l.workspace_id = p_workspace_id
      -- El corte por fecha actual: los dias sembrados por delante existen en la
      -- base pero no se muestran hasta que llega su dia.
      and (l.fecha_hora at time zone 'America/Bogota')::date between r.desde and r.hasta
      and (p_staff_id is null or l.agente_staff_id = p_staff_id)
  ),
  pagina as (
    select * from base order by fecha_hora desc limit greatest(p_limite, 1)
  )
  select jsonb_build_object(
    'desde',     (select desde from rango),
    'hasta',     (select hasta from rango),
    'dias',      p_dias,
    'total',     (select count(*) from base),
    'mostradas', (select count(*) from pagina),

    -- KPIs sobre el periodo completo, NO sobre la pagina: un porcentaje
    -- calculado sobre las primeras N filas no es el porcentaje de nada.
    'kpis', (
      select jsonb_build_object(
        'llamadas', count(*),
        'rojo',     count(*) filter (where semaforo = 'rojo'),
        'amarillo', count(*) filter (where semaforo = 'amarillo'),
        'verde',    count(*) filter (where semaforo = 'verde'),
        'tecnica',  coalesce(round(avg(puntaje_tecnico)), 0)
      ) from base
    ),

    'filas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',              p.id,
          'clienteRef',      p.cliente_ref,
          'fechaHora',       p.fecha_hora,
          'fechaGrabacion',  p.fecha_grabacion,
          'direccion',       p.direccion,
          'duracionSeg',     p.duracion_seg,
          'agenteNombre',    p.agente_nombre,
          'puntajeTecnico',  p.puntaje_tecnico,
          'semaforo',        p.semaforo,
          'detalleCompleto', p.detalle_completo,
          'esReal',          p.es_real,
          'codigos',         coalesce(h.codigos, '[]'::jsonb),
          'criticas',        coalesce(h.criticas, 0)
        ) order by p.fecha_hora desc
      )
      from pagina p
      -- Los codigos viajan CON la fila. Es el punto del arreglo.
      left join lateral (
        select
          jsonb_agg(distinct x.codigo order by x.codigo)              as codigos,
          count(*) filter (where x.severidad = 'critica')             as criticas
        from calidad_llamadas_hallazgos x
        where x.llamada_id = p.id
          and x.eje = 'cumplimiento'
          and x.codigo is not null
      ) h on true
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.get_calidad_lista(uuid, uuid, integer, integer) from public;
revoke execute on function public.get_calidad_lista(uuid, uuid, integer, integer) from anon;
grant  execute on function public.get_calidad_lista(uuid, uuid, integer, integer) to authenticated;
grant  execute on function public.get_calidad_lista(uuid, uuid, integer, integer) to service_role;

create index if not exists idx_calidad_hallazgos_llamada_eje
  on public.calidad_llamadas_hallazgos(llamada_id, eje);
