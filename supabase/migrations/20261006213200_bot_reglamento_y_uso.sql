-- El reglamento versionado del núcleo conversacional, la tabla de precios por modelo y el contador de uso.
--
-- Diseño: proyectos/trappvel/clarity/docs/diseno/2026-10-06_investigacion-agentes-conversacionales.md, §3.4 y §3.8.
-- Brief: brief-max-2026-10-06-nucleo-conversacional.md, punto 2, y el pedido de Mauricio del 2026-10-06 (contador por
-- workspace y mes, cupo de uso justo).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Qué hace
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. `bot_parametros`: las fichas del reglamento en edición (alcance, invariantes, glosario, guías, procedimientos,
--    respuestas fijas, estilo y perfil). `workspace_id` nulo = ficha global del núcleo; una ficha del workspace con la
--    misma clave reemplaza a la global.
-- 2. `bot_reglamentos`: las versiones publicadas, cada una una foto inmutable de las fichas con su huella sha256.
--    `bot_publicar_reglamento` la crea desde las fichas vigentes. El núcleo lee la versión de
--    `bot_conversacional.agente_config.reglamento_id` o, sin ella, la última publicada. Volver atrás = cambiar el puntero.
-- 3. `bot_modelo_precios`: USD por millón de tokens, por modelo. NACE VACÍA: los precios los carga MéTRIK desde la página
--    oficial del proveedor, con su fuente. Ningún precio está escrito en el código ni en esta migración.
-- 4. `bot_uso_mes`: turnos del modelo, llamados, tokens (entrada, salida, razonamiento, caché) y costo estimado de un
--    workspace en un mes de Bogotá, leídos de las trazas de `wa_conversacion` (migración 20261006213100). Sin tabla de
--    contadores: la traza ya lo tiene todo.
--
-- No siembra nada: el reglamento de la bandeja (Anexo A) va solo en un workspace de prueba (ver
-- `sql/trappvel/2026-10-06_reglamento-bandeja-PRUEBA.sql`), nunca en producción.
-- No toca datos existentes.
--
-- epoca: no-rompe tablas y funciones nuevas; nada del código de hoy las usa.

create table public.bot_parametros (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  bot text not null,
  clave text not null,
  tipo text not null,
  carga text not null,
  cuando text,
  hacer text not null,
  herramientas text[],
  prioridad integer,
  fuente text,
  valores jsonb,
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint bot_parametros_tipo check (tipo in ('perfil', 'alcance', 'invariante', 'glosario', 'guia', 'procedimiento', 'respuesta_fija', 'estilo')),
  constraint bot_parametros_carga check (carga in ('siempre', 'indice', 'con_herramienta'))
);

-- Una clave por bot y alcance (global o del workspace).
create unique index bot_parametros_clave on public.bot_parametros (bot, coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), clave);

comment on table public.bot_parametros is
  'Fichas del reglamento de un bot conversacional, en edicion. workspace_id nulo = ficha global del nucleo; la del workspace con la misma clave la reemplaza. Se publican con bot_publicar_reglamento.';

alter table public.bot_parametros enable row level security;
-- server-only: la editan MéTRIK por SQL y la publica una función de servicio; la app no la usa todavía.
revoke all on public.bot_parametros from anon, authenticated;
grant all on public.bot_parametros to service_role;

create table public.bot_reglamentos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bot text not null,
  version integer not null,
  fichas jsonb not null,
  huella text not null,
  publicado_por text not null,
  publicado_at timestamptz not null default now(),
  -- El resultado del banco que habilitó la versión (§3.4, paso 3).
  banco jsonb,
  constraint bot_reglamentos_version unique (workspace_id, bot, version)
);

comment on table public.bot_reglamentos is
  'Versiones publicadas (inmutables) del reglamento de un bot por workspace, con su huella sha256. El nucleo lee la del puntero bot_conversacional.agente_config.reglamento_id o la ultima.';

alter table public.bot_reglamentos enable row level security;
-- server-only: la lee solo el bot (service_role).
revoke all on public.bot_reglamentos from anon, authenticated;
grant all on public.bot_reglamentos to service_role;

-- Inmutable: una versión publicada no se edita (para volver atrás se mueve el puntero; el borrado solo llega en cascada con el workspace).
create or replace function public.bot_reglamentos_inmutable() returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'bot_reglamentos es inmutable: publica una version nueva';
end;
$$;

revoke execute on function public.bot_reglamentos_inmutable() from public, anon, authenticated;

create trigger bot_reglamentos_inmutable
  before update on public.bot_reglamentos
  for each row execute function public.bot_reglamentos_inmutable();

-- Publica las fichas activas (las globales más las del workspace, que ganan por clave) como una versión nueva.
-- La huella es el sha256 del jsonb canónico de las fichas ordenadas por clave. Devuelve el id de la versión.
create or replace function public.bot_publicar_reglamento(
  p_workspace_id uuid,
  p_bot text,
  p_publicado_por text,
  p_banco jsonb default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_fichas jsonb;
  v_version integer;
  v_id uuid;
begin
  select coalesce(jsonb_agg(f order by f->>'clave'), '[]'::jsonb) into v_fichas
  from (
    select distinct on (p.clave) jsonb_strip_nulls(jsonb_build_object(
      'clave', p.clave, 'tipo', p.tipo, 'carga', p.carga, 'cuando', p.cuando, 'hacer', p.hacer,
      'herramientas', to_jsonb(p.herramientas), 'prioridad', p.prioridad, 'fuente', p.fuente, 'valores', p.valores
    )) as f
    from public.bot_parametros p
    where p.bot = p_bot and p.activo and (p.workspace_id = p_workspace_id or p.workspace_id is null)
    order by p.clave, (p.workspace_id is null)
  ) x;

  if jsonb_array_length(v_fichas) = 0 then
    raise exception 'no hay fichas activas para % en el workspace %', p_bot, p_workspace_id;
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.bot_reglamentos where workspace_id = p_workspace_id and bot = p_bot;

  insert into public.bot_reglamentos (workspace_id, bot, version, fichas, huella, publicado_por, banco)
  values (p_workspace_id, p_bot, v_version, v_fichas, encode(sha256(convert_to(v_fichas::text, 'UTF8')), 'hex'), p_publicado_por, p_banco)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.bot_publicar_reglamento(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.bot_publicar_reglamento(uuid, text, text, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Precios y uso
-- ─────────────────────────────────────────────────────────────────────────────

create table public.bot_modelo_precios (
  modelo text primary key,
  usd_millon_entrada numeric not null,
  usd_millon_salida numeric not null,
  -- Lo que cuesta un token de entrada leído del caché; nulo = el de entrada.
  usd_millon_cache numeric,
  -- De dónde salió el precio (URL de la página oficial y fecha de lectura). Obligatorio: un precio sin fuente no entra.
  fuente text not null,
  actualizado_at timestamptz not null default now(),
  constraint bot_modelo_precios_positivos check (usd_millon_entrada >= 0 and usd_millon_salida >= 0 and (usd_millon_cache is null or usd_millon_cache >= 0))
);

comment on table public.bot_modelo_precios is
  'USD por millon de tokens por modelo, para el costo estimado del bot conversacional. Se carga a mano desde la pagina oficial del proveedor (columna fuente). Nace vacia.';

alter table public.bot_modelo_precios enable row level security;
-- server-only: la lee solo bot_uso_mes con service_role.
revoke all on public.bot_modelo_precios from anon, authenticated;
grant all on public.bot_modelo_precios to service_role;

-- El uso de un workspace en un mes de Bogotá (`p_mes` = cualquier día del mes). Turno = una traza de tipo `modelo`;
-- llamado = un uso de su arreglo (el principal y el respaldo cuentan aparte). Costo por modelo:
--   (entrada − caché) × entrada + caché × (caché o entrada) + (salida + razonamiento) × salida, todo / 1.000.000.
-- `costo_usd` es nulo si algún modelo usado no tiene precio (queda en `sin_precio`).
create or replace function public.bot_uso_mes(p_workspace_id uuid, p_mes date)
returns jsonb
language sql
stable
set search_path = public
as $$
  with limites as (
    select (date_trunc('month', p_mes)::timestamp at time zone 'America/Bogota') as desde,
           ((date_trunc('month', p_mes) + interval '1 month')::timestamp at time zone 'America/Bogota') as hasta
  ),
  turnos as (
    select c.traza
    from public.wa_conversacion c, limites l
    where c.workspace_id = p_workspace_id
      and c.created_at >= l.desde and c.created_at < l.hasta
      and c.traza->>'tipo' = 'modelo'
  ),
  usos as (
    select u->>'modelo' as modelo,
           coalesce((u->>'entrada')::bigint, 0) as entrada,
           coalesce((u->>'salida')::bigint, 0) as salida,
           coalesce((u->>'razonamiento')::bigint, 0) as razonamiento,
           coalesce((u->>'cache')::bigint, 0) as cache
    from turnos t, jsonb_array_elements(coalesce(t.traza->'uso', '[]'::jsonb)) u
  ),
  por_modelo as (
    select u.modelo, count(*) as llamados, sum(u.entrada) as entrada, sum(u.salida) as salida,
           sum(u.razonamiento) as razonamiento, sum(u.cache) as cache,
           case when p.modelo is null then null else
             ((sum(u.entrada) - sum(u.cache)) * p.usd_millon_entrada
              + sum(u.cache) * coalesce(p.usd_millon_cache, p.usd_millon_entrada)
              + (sum(u.salida) + sum(u.razonamiento)) * p.usd_millon_salida) / 1000000.0
           end as costo_usd
    from usos u left join public.bot_modelo_precios p on p.modelo = u.modelo
    group by u.modelo, p.modelo, p.usd_millon_entrada, p.usd_millon_cache, p.usd_millon_salida
  )
  select jsonb_build_object(
    'mes', to_char(p_mes, 'YYYY-MM'),
    'turnos', (select count(*) from turnos),
    'llamados', coalesce((select sum(llamados) from por_modelo), 0),
    'entrada', coalesce((select sum(entrada) from por_modelo), 0),
    'salida', coalesce((select sum(salida) from por_modelo), 0),
    'razonamiento', coalesce((select sum(razonamiento) from por_modelo), 0),
    'cache', coalesce((select sum(cache) from por_modelo), 0),
    'costo_usd', case when exists (select 1 from por_modelo where costo_usd is null) then null
                      else coalesce((select sum(costo_usd) from por_modelo), 0) end,
    'sin_precio', coalesce((select jsonb_agg(modelo order by modelo) from por_modelo where costo_usd is null), '[]'::jsonb),
    'por_modelo', coalesce((select jsonb_object_agg(modelo, jsonb_build_object(
      'llamados', llamados, 'entrada', entrada, 'salida', salida, 'razonamiento', razonamiento, 'cache', cache, 'costo_usd', costo_usd
    )) from por_modelo), '{}'::jsonb)
  );
$$;

comment on function public.bot_uso_mes(uuid, date) is
  'Uso del bot conversacional de un workspace en un mes de Bogota (turnos, llamados, tokens y costo estimado), desde las trazas de wa_conversacion y bot_modelo_precios. Solo service_role.';

revoke execute on function public.bot_uso_mes(uuid, date) from public, anon, authenticated;
grant execute on function public.bot_uso_mes(uuid, date) to service_role;

-- La lectura del contador por mes: trazas de turno del modelo por workspace y fecha.
create index wa_conversacion_trazas_modelo on public.wa_conversacion (workspace_id, created_at) where traza->>'tipo' = 'modelo';
