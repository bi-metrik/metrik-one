-- Tres arreglos al modulo de calidad, detectados al abrir el muro en el navegador.
--
-- 1. `fecha_grabacion`: separa CUANDO se grabo la llamada de CUANDO se muestra.
-- 2. `get_calidad_muro` cae al ultimo dia con actividad si el dia pedido esta vacio.
-- 3. El muro agrupa y muestra la hora en horario de Colombia, no en UTC.
--
-- Origen: el seed anclaba todo al 2026-05-21 (la fecha de la llamada real de
-- Regat) y el muro consulta el dia en curso, asi que la pantalla salia vacia
-- siempre — incluido el dia de la reunion. Un muro vacio responde 200 y no
-- contiene ni dinero ni apellidos, asi que la verificacion por HTML lo dejo
-- pasar: cuando lo que se valida es una pantalla, hay que mirar que tenga
-- contenido, no solo que no tenga lo prohibido.

-- ── 1. Fecha real de la grabacion ───────────────────────────────────────────
--
-- `fecha_hora` es la marca de tiempo con la que la llamada se lista y se
-- agrupa por dia. En un workspace de demostracion se ancla al dia en que se
-- corre el seed, para que el muro tenga contenido cualquier dia que se abra.
--
-- `fecha_grabacion` es la fecha VERDADERA de la grabacion y no se mueve nunca.
-- Solo la llevan las llamadas que corresponden a una auditoria real; en los
-- datos de demostracion queda NULL, porque no hay grabacion que fechar.
--
-- Mover `fecha_hora` en un workspace rotulado como demostracion es legitimo;
-- perder la fecha verdadera de la grabacion no lo es. Por eso son dos columnas
-- y no una.
alter table public.calidad_llamadas
  add column if not exists fecha_grabacion timestamptz;

comment on column public.calidad_llamadas.fecha_grabacion is
  'Fecha y hora REAL de la grabacion auditada. NULL en datos de demostracion. A diferencia de fecha_hora, esta columna nunca se reancla.';

-- ── 2. Muro con red de seguridad ────────────────────────────────────────────
--
-- Si el dia consultado no tiene llamadas, el muro cae al ultimo dia CON
-- actividad y devuelve esa fecha efectiva, para que la pantalla pueda decir de
-- que dia esta hablando. En operacion real no se activa nunca (siempre hay
-- llamadas hoy); en una demo evita que una fecha corrida deje el televisor en
-- blanco.
--
-- ── 3. Horario de Colombia, no UTC ──────────────────────────────────────────
--
-- `fecha_hora::date` y `to_char(fecha_hora, 'HH24:MI')` se evaluan en la zona
-- de la sesion de Postgres, que es UTC. Una llamada de las 18:58 en Colombia
-- salia en el muro como "23:58", y una de la noche se habria agrupado en el dia
-- siguiente. ONE es un producto colombiano y el muro se renderiza server-side
-- sin navegador que aporte zona, asi que se fija America/Bogota de forma
-- explicita en los tres sitios: el default del parametro, el agrupamiento por
-- dia y la hora que se pinta.
--
-- Se conserva todo lo demas: sigue sin devolver `cliente_ref` ni columna
-- monetaria alguna, y los agentes siguen saliendo por nombre de pila.
create or replace function public.get_calidad_muro(
  p_workspace_id uuid,
  p_fecha        date default (now() at time zone 'America/Bogota')::date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with efectiva as (
    select coalesce(
      -- El dia pedido, si tiene actividad.
      (select p_fecha
        where exists (
          select 1 from calidad_llamadas
          where workspace_id = p_workspace_id
            and (fecha_hora at time zone 'America/Bogota')::date = p_fecha
        )),
      -- Si no, el ultimo dia con llamadas.
      (select max((fecha_hora at time zone 'America/Bogota')::date)
         from calidad_llamadas where workspace_id = p_workspace_id)
    ) as fecha
  ),
  dia as (
    select c.*
    from calidad_cobertura_dia c, efectiva e
    where c.workspace_id = p_workspace_id and c.fecha = e.fecha
  ),
  llamadas_dia as (
    select l.*
    from calidad_llamadas l, efectiva e
    where l.workspace_id = p_workspace_id
      and (l.fecha_hora at time zone 'America/Bogota')::date = e.fecha
  )
  select jsonb_build_object(
    'fecha', (select fecha from efectiva),
    -- true = el dia pedido estaba vacio y esto es el ultimo dia con actividad.
    'esFallback', (select fecha from efectiva) is distinct from p_fecha,
    'cobertura', (
      select jsonb_build_object(
        'recibidas', coalesce(recibidas, 0),
        'auditadas', coalesce(auditadas, 0),
        'baseline',  coalesce(baseline_manual, 0),
        'pct', case when coalesce(recibidas, 0) > 0
                    then round(100.0 * auditadas / recibidas)
                    else 0 end,
        'pctBaseline', case when coalesce(recibidas, 0) > 0
                    then round(100.0 * baseline_manual / recibidas)
                    else 0 end
      ) from dia
    ),
    'ultimas', coalesce((
      select jsonb_agg(x order by ord desc) from (
        select jsonb_build_object(
                 'hora',     to_char(fecha_hora at time zone 'America/Bogota', 'HH24:MI'),
                 -- Nombre de pila unicamente: el muro es publico por enlace.
                 'agente',   split_part(agente_nombre, ' ', 1),
                 'duracion', duracion_seg,
                 'tecnica',  puntaje_tecnico,
                 'semaforo', semaforo
               ) x,
               fecha_hora ord
        from llamadas_dia
        order by fecha_hora desc
        limit 12
      ) s
    ), '[]'::jsonb),
    'semaforos', (
      select jsonb_build_object(
        'verde',    count(*) filter (where semaforo = 'verde'),
        'amarillo', count(*) filter (where semaforo = 'amarillo'),
        'rojo',     count(*) filter (where semaforo = 'rojo'),
        'total',    count(*)
      ) from llamadas_dia
    ),
    'banderaTop', (
      select jsonb_build_object('codigo', h.codigo, 'titulo', min(h.titulo), 'veces', count(*))
      from calidad_llamadas_hallazgos h
      join llamadas_dia l on l.id = h.llamada_id
      where h.eje = 'cumplimiento' and h.codigo is not null
      group by h.codigo
      order by count(*) desc, h.codigo
      limit 1
    )
  );
$$;

revoke execute on function public.get_calidad_muro(uuid, date) from public;
revoke execute on function public.get_calidad_muro(uuid, date) from anon;
grant  execute on function public.get_calidad_muro(uuid, date) to authenticated;
grant  execute on function public.get_calidad_muro(uuid, date) to service_role;

-- La columna nueva hereda los privilegios de la tabla, que ya quedaron
-- acotados a `select` para `authenticated` en la migracion anterior. No hay
-- nada que revocar aqui.
