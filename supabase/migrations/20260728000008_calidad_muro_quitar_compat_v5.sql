-- Se quitan las claves de compatibilidad con el codigo v5. Tercer y ultimo paso.
--
-- El 2026-07-28 se aplico la migracion v6 a la base ANTES de desplegar su
-- consumidor. Como la base es compartida entre `main` y cualquier rama, el muro
-- publico de Regat quedo ~20 min mostrando "Sin llamadas en este periodo": el
-- codigo desplegado leia `cierres` / `cobertura` / `banderaTop` / `rankings` a
-- nivel raiz y v6 los habia movido dentro de `periodos`.
--
-- La reparacion fue hacer que la RPC devolviera las DOS formas, con las claves
-- viejas marcadas `BORRAR tras el merge`. Ese es el paso que se cierra aqui:
--
--   1. ampliar conservando lo viejo   → 20260728000006 / 000007
--   2. desplegar el consumidor nuevo  → PR #126, merge 56bb72c, produccion READY
--   3. borrar lo viejo                → esta migracion
--
-- Verificado antes de aplicar (que es el orden que el incidente enseño):
--   · `git grep` en `origin/main` no encuentra ningun lector de esas claves.
--   · El unico consumidor de la RPC es `getMuroPorWorkspace` (calidad/actions),
--     y el tipo `MuroData` en main solo declara `fecha`, `esFallback`,
--     `periodos` y `ultimas`.
--   · La rotacion ya se vio funcionando en produccion con el codigo nuevo.
--
-- Queda la forma canonica y una sola: todo lo agregado vive por periodo, y las
-- ultimas llamadas a nivel raiz porque no rotan.
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
    -- Red de seguridad de fecha: si el dia pedido no tuvo actividad, cae al
    -- ultimo dia con llamadas — pero SOLO hacia atras (`<= p_fecha`). El seed
    -- siembra hasta el dia de la demo, asi que sin ese techo un dia sin
    -- llamadas saltaria a mostrar el futuro por anticipado.
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
  -- Semana y mes son ventanas MOVILES (ultimos 7 y 30 dias), no calendario: un
  -- lunes, "la semana" calendario mostraria un solo dia, que en un televisor es
  -- peor que no mostrar nada.
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

    -- ── Flujo: NO rota ──
    --
    -- Las diez ultimas son el pulso en vivo. En vista de mes serian las mismas
    -- diez que en vista de dia, asi que recalcularlas por periodo es trabajo
    -- sin efecto — y peor: sugeriria que cambian cuando no cambian.
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
$$;

revoke execute on function public.get_calidad_muro(uuid, date) from public;
revoke execute on function public.get_calidad_muro(uuid, date) from anon;
grant  execute on function public.get_calidad_muro(uuid, date) to authenticated;
grant  execute on function public.get_calidad_muro(uuid, date) to service_role;
