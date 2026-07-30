-- El pie del muro deja de afirmar de memoria cuantas llamadas son reales.
--
-- Decia, escrito a mano: "Datos de demostracion: una llamada real, el resto es
-- muestra". En Regat es cierto por casualidad (1 real de 2.824). En Advise es
-- FALSO: hay 0 reales de 565, y esa linea se proyecta en la reunion con el
-- cliente. Una pantalla sana que afirma algo que no es.
--
-- Es el mismo patron que ya se corrigio en la linea de "cobrado": el numero
-- sale del dato, no de lo que alguien recordaba cuando escribio el texto. Si
-- manana entran audios reales de Advise, la linea se corrige sola.
--
-- Se AMPLIA la funcion con la clave `muestra`; no se cambia nada de lo que ya
-- devuelve. El consumidor desplegado no la lee y sigue funcionando igual.
--
-- El conteo es del WORKSPACE COMPLETO, no del periodo que este rotando en
-- pantalla: es un descargo sobre el origen de los datos, no una metrica. Que
-- cambiara cada vez que el muro gira de dia a semana seria ruido, y ademas
-- podria decir "ninguna real" en un dia y "una real" en el mes, sobre la misma
-- pantalla.

create or replace function public.get_calidad_muro(
  p_workspace_id uuid,
  p_fecha        date default ((now() at time zone 'America/Bogota'::text))::date
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with efectiva as (
    select coalesce(
      (select p_fecha
        where exists (
          select 1 from calidad_llamadas
          where workspace_id = p_workspace_id
            and (fecha_hora at time zone 'America/Bogota')::date = p_fecha
        )),
      (select max((fecha_hora at time zone 'America/Bogota')::date)
         from calidad_llamadas
        where workspace_id = p_workspace_id
          and (fecha_hora at time zone 'America/Bogota')::date <= p_fecha)
    ) as fecha
  ),
  bloques as (
    select
      e.fecha,
      calidad_bloque_periodo(p_workspace_id, e.fecha,      e.fecha) as dia,
      calidad_bloque_periodo(p_workspace_id, e.fecha - 6,  e.fecha) as semana,
      calidad_bloque_periodo(p_workspace_id, e.fecha - 29, e.fecha) as mes
    from efectiva e
  )
  select jsonb_build_object(
    'fecha', b.fecha,
    'esFallback', b.fecha is distinct from p_fecha,
    'periodos', jsonb_build_object('dia', b.dia, 'semana', b.semana, 'mes', b.mes),
    -- De donde salen los datos que se estan viendo. Lo redacta la pantalla.
    'muestra', (
      select jsonb_build_object(
        'reales', count(*) filter (where l.es_real),
        'total',  count(*)
      )
      from calidad_llamadas l
      where l.workspace_id = p_workspace_id
    ),
    'ultimas', coalesce((
      select jsonb_agg(x order by ord desc) from (
        select jsonb_build_object(
                 'hora',       to_char(fecha_hora at time zone 'America/Bogota', 'HH24:MI'),
                 'agente',     split_part(agente_nombre, ' ', 1),
                 'tecnica',    puntaje_tecnico,
                 'semaforo',   semaforo,
                 'cerroVenta', cerro_venta
               ) x,
               fecha_hora ord
        from calidad_llamadas l
        where l.workspace_id = p_workspace_id
          and (l.fecha_hora at time zone 'America/Bogota')::date = b.fecha
        order by fecha_hora desc
        limit 10
      ) s
    ), '[]'::jsonb)
  )
  from bloques b;
$function$;
