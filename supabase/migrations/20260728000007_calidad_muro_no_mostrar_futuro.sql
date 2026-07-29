-- El muro nunca muestra dias que todavia no llegaron.
--
-- El seed ancla al dia de la DEMO (viernes 31 de julio) y siembra 30 dias hacia
-- atras, para que la pantalla funcione cualquier dia de esa semana sin que
-- nadie tenga que acordarse de re-sembrar esa mañana. Eso deja dias FUTUROS en
-- la tabla, y hay que garantizar que no se filtren: hoy el muro tiene que
-- mostrar hoy, no el viernes.
--
-- El unico punto por donde se colaban era la red de seguridad de fecha. Decia
-- "si el dia pedido no tiene llamadas, cae al ultimo dia con actividad" —
-- `max(fecha)` sin techo. Con historia sembrada hacia adelante ese maximo es el
-- futuro, asi que un dia sin llamadas (un domingo, un feriado) habria saltado a
-- mostrar el viernes por anticipado, con cierres y montos que aun no ocurren.
--
-- Ahora el fallback se acota a `<= p_fecha`: sigue siendo red de seguridad
-- (nunca deja el televisor en blanco) pero solo puede caer hacia ATRAS.
--
-- Las ventanas de semana y mes ya estaban a salvo: se calculan restando dias a
-- la fecha efectiva, que es <= hoy por construccion.
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
      (select p_fecha
        where exists (
          select 1 from calidad_llamadas
          where workspace_id = p_workspace_id
            and (fecha_hora at time zone 'America/Bogota')::date = p_fecha
        )),
      -- Solo hacia atras: el techo es la fecha pedida.
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
    ), '[]'::jsonb),

    -- ── Compatibilidad con el codigo v5 desplegado. BORRAR tras el merge. ──
    'cierres',    b.dia->'cierres',
    'cobertura',  b.dia->'cobertura',
    'banderaTop', b.dia->'banderaTop',
    'rankings', jsonb_build_object(
      'dia',    (b.dia->'ranking')    || jsonb_build_object('desde', b.dia->'desde',    'hasta', b.dia->'hasta'),
      'semana', (b.semana->'ranking') || jsonb_build_object('desde', b.semana->'desde', 'hasta', b.semana->'hasta'),
      'mes',    (b.mes->'ranking')    || jsonb_build_object('desde', b.mes->'desde',    'hasta', b.mes->'hasta')
    )
  )
  from bloques b;
$$;

revoke execute on function public.get_calidad_muro(uuid, date) from public;
revoke execute on function public.get_calidad_muro(uuid, date) from anon;
grant  execute on function public.get_calidad_muro(uuid, date) to authenticated;
grant  execute on function public.get_calidad_muro(uuid, date) to service_role;
