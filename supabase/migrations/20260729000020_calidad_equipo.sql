-- Equipo, para el supervisor: el mismo ranking del muro, pero para gestionar.
--
-- El muro se mira de pie y a tres metros. Esta pantalla se mira sentado, se
-- ordena y se hace clic en una persona. Es la misma informacion con otro uso, y
-- por eso NO es otra fuente: el ranking sale de `calidad_ranking_periodo`, la
-- funcion que ya alimenta el muro. Si fueran dos calculos, en algun borde
-- dirian numeros distintos del mismo equipo y nadie podria decir cual miente.
--
-- Lo unico que cambia es el NOMBRE. El muro es publico y por eso corta el
-- apellido desde el arranque; aqui hace falta completo, porque el nombre es el
-- enlace al perfil y "Felipe" no identifica a nadie en una operacion de 200
-- agentes. Se resuelve AMPLIANDO la funcion con un parametro que por defecto se
-- comporta como hoy, no escribiendo un segundo ranking.

-- ── 1. El ranking, ampliado con el nombre completo ──────────────────────────
--
-- Se borra y se recrea porque agregar un parametro cambia la firma. El default
-- `false` mantiene el comportamiento exacto de hoy: `get_calidad_muro` la llama
-- con tres argumentos y sigue recibiendo nombres de pila, sin tocar el muro.
drop function if exists public.calidad_ranking_periodo(uuid, date, date);

create or replace function public.calidad_ranking_periodo(
  p_workspace_id   uuid,
  p_desde          date,
  p_hasta          date,
  p_nombre_completo boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      l.id,
      -- Nombre de pila por defecto: el apellido no existe en ningun punto del
      -- pipeline del muro, ni siquiera en un agregado intermedio, porque el
      -- muro es publico. Completo solo cuando quien pregunta ya esta adentro.
      case when p_nombre_completo then l.agente_nombre
           else split_part(l.agente_nombre, ' ', 1) end as agente,
      l.puntaje_tecnico,
      l.cerro_venta
    from calidad_llamadas l
    where l.workspace_id = p_workspace_id
      and (l.fecha_hora at time zone 'America/Bogota')::date between p_desde and p_hasta
  ),
  criticas as (
    select b.agente, count(*) as n
    from calidad_llamadas_hallazgos h
    join base b on b.id = h.llamada_id
    where h.eje = 'cumplimiento' and h.severidad = 'critica'
    group by 1
  ),
  agg as (
    select
      b.agente,
      count(*)                                   as llamadas,
      count(*) filter (where b.cerro_venta)      as cierres,
      round(avg(b.puntaje_tecnico))::int         as tecnica,
      coalesce(max(c.n), 0)::int                 as banderas
    from base b
    left join criticas c on c.agente = b.agente
    group by b.agente
  ),
  umbrales as (
    select
      percentile_cont(0.33) within group (order by tecnica)  as tecnica_baja,
      percentile_cont(0.67) within group (order by tecnica)  as tecnica_alta,
      percentile_cont(0.33) within group (order by banderas) as banderas_baja,
      percentile_cont(0.67) within group (order by banderas) as banderas_alta
    from agg
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
        -- Orden por cierres: asi se lee un ranking de ventas. Tecnica y
        -- banderas son las columnas que lo desmienten o lo confirman, no las
        -- que ordenan — por eso el desempate es por VOLUMEN, no por calidad.
        order by cierres desc, llamadas desc, agente
      ) from agg
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
$$;

revoke execute on function public.calidad_ranking_periodo(uuid, date, date, boolean) from public;
revoke execute on function public.calidad_ranking_periodo(uuid, date, date, boolean) from anon;
grant  execute on function public.calidad_ranking_periodo(uuid, date, date, boolean) to authenticated;
grant  execute on function public.calidad_ranking_periodo(uuid, date, date, boolean) to service_role;


-- ── 2. Equipo: ranking + lo que el ranking no puede decir ───────────────────
--
-- El ranking dice donde esta cada uno HOY. No dice hacia donde va, y esa es la
-- pregunta del supervisor: a quien hay que sentar esta semana. La tendencia se
-- calcula con el MISMO criterio del perfil (t = pendiente / error estandar,
-- |t| >= 2), no con uno nuevo: si la tarjeta dijera "viene bajando" y el perfil
-- dijera "estable", el supervisor dejaria de creerle a los dos.
--
-- `vendidoUsd` sale de `monto_usd` de las mismas llamadas cerradas, que es de
-- donde lo saca el perfil. No entra al ranking del muro a proposito: esa
-- funcion no devuelve columnas monetarias por construccion, y el muro es
-- publico.
create or replace function public.get_calidad_equipo(
  p_workspace_id uuid,
  p_desde        date,
  p_hasta        date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      l.agente_nombre as agente,
      l.puntaje_tecnico,
      l.cerro_venta,
      l.monto_usd,
      (l.fecha_hora at time zone 'America/Bogota')::date as dia,
      -- Eje X de la regresion: dias desde la epoca. La escala no importa, solo
      -- que sea lineal en el tiempo.
      extract(epoch from (l.fecha_hora at time zone 'America/Bogota')) / 86400.0 as x
    from calidad_llamadas l
    where l.workspace_id = p_workspace_id
      and (l.fecha_hora at time zone 'America/Bogota')::date between p_desde and p_hasta
  ),
  reg as (
    select
      agente,
      regr_slope(puntaje_tecnico, x)  as pendiente,
      regr_count(puntaje_tecnico, x)  as n,
      regr_sxx(puntaje_tecnico, x)    as sxx,
      regr_syy(puntaje_tecnico, x)    as syy,
      avg(puntaje_tecnico) filter (where dia <  (p_desde + (p_hasta - p_desde) / 2)) as primera,
      avg(puntaje_tecnico) filter (where dia >= (p_desde + (p_hasta - p_desde) / 2)) as segunda,
      coalesce(sum(monto_usd) filter (where cerro_venta), 0) as vendido
    from base
    group by agente
  )
  select jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    -- El ranking, con nombre completo: aqui el nombre es el enlace al perfil.
    'ranking', calidad_ranking_periodo(p_workspace_id, p_desde, p_hasta, true),
    'agentes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'agente',     agente,
          'vendidoUsd', vendido,
          'tendencia', jsonb_build_object(
            'n', coalesce(n, 0),
            'porSemana', case when n >= 3 then round((pendiente * 7)::numeric, 1) else null end,
            't', case
                   when n >= 3 and sxx > 0 and (syy - pendiente * pendiente * sxx) > 0
                   then round(
                          (pendiente / sqrt(
                            (syy - pendiente * pendiente * sxx) / ((n - 2) * sxx)
                          ))::numeric, 2)
                   else null
                 end,
            'primeraMitad', round(primera),
            'segundaMitad', round(segunda)
          )
        ) order by agente
      ) from reg
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.get_calidad_equipo(uuid, date, date) from public;
revoke execute on function public.get_calidad_equipo(uuid, date, date) from anon;
grant  execute on function public.get_calidad_equipo(uuid, date, date) to authenticated;
grant  execute on function public.get_calidad_equipo(uuid, date, date) to service_role;
