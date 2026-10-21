-- El bot de WhatsApp asigna los gastos a NEGOCIOS, y deja de reventar al buscar proyectos.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Por qué (producción, 2026-10-20 22:47, workspace metrik)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- «Registra un gasto de 27000 por transportes al proyecto impervium» → el bot buscó «impervium» en negocios (solo
-- por NOMBRE del negocio, con ILIKE: no lo encontró porque Impervium es la EMPRESA) y en proyectos legacy con
-- `wa_find_projects`, que falló con `42703 column v.cartera does not exist`: `v_proyecto_financiero` dejó de tener
-- `cartera` el 2026-04-27 (`20260427100002_simplificar_fiscal.sql`) y la función nunca se actualizó.
--
-- 1. `wa_find_projects`: se reemplaza `v.cartera` por `(v.facturado - v.cobrado)` y se conserva la firma (la columna
--    `cartera` de la salida sigue ahí). La definición VIVA no está en el repo (tiene ramas por `empresa_codigo` que no
--    trae ninguna migración), así que en vez de reescribirla de memoria se toma la que hay en la base con
--    `pg_get_functiondef` y se le cambia solo esa expresión. Así se conservan su cuerpo, `SECURITY DEFINER`, su
--    `search_path` y su ACL. Si ya no lee `v.cartera`, no hace nada (idempotente).
--    El bot deja de llamarla en el flujo del gasto (proyectos legacy: 0 en metrik, 0 gastos con proyecto en 60 días),
--    y ninguna otra función del bot la usa. Se arregla igual para que no quede una RPC rota a la vista; retirarla es
--    otro PR.
--
-- 2. `wa_find_negocios` (nueva): busca negocios abiertos del workspace por
--      · CÓDIGO, normalizado: «I1 26 5», «i1 26 5», «I1-26-5» e «I1265» son el mismo. Si hay código, manda él y
--        devuelve a lo sumo uno (`coincidencia = 'codigo'`).
--      · TEXTO: nombre del negocio, de la empresa o del contacto, sin tildes ni mayúsculas. Todas las palabras dadas
--        (sin «proyecto», «negocio», «el», «de»…) presentes → `exacta`; parecido por trigramas → `parecida`.
--    Estados: `abierto` y `activo` (el `activo` del CHECK viejo); los cerrados, completados, perdidos y cancelados no
--    reciben gastos por el bot, igual que hoy (`findActiveNegocios` filtra `abierto`).
--
-- Solo lectura: no toca datos. `pg_trgm` y `unaccent` ya están en `public` (ver 20261005190000).
--
-- epoca: no-rompe función nueva de solo lectura y un reemplazo con la misma firma; no borra ni renombra nada.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. wa_find_projects sin v.cartera
-- ─────────────────────────────────────────────────────────────────────────────

do $parche$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.wa_find_projects(uuid, text, integer)'::regprocedure);
  if position('v.cartera' in v_def) = 0 then
    raise notice 'wa_find_projects ya no lee v.cartera: sin cambios';
    return;
  end if;
  -- pg_get_functiondef devuelve un CREATE OR REPLACE completo (atributos, search_path y cuerpo).
  execute replace(v_def, 'v.cartera', '(v.facturado - v.cobrado)');
  if position('v.cartera' in pg_get_functiondef('public.wa_find_projects(uuid, text, integer)'::regprocedure)) > 0 then
    raise exception 'wa_find_projects sigue leyendo v.cartera';
  end if;
end
$parche$;

-- La llama solo el servidor (edge function con service_role). CREATE OR REPLACE conserva la ACL; se re-afirma igual.
revoke execute on function public.wa_find_projects(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.wa_find_projects(uuid, text, integer) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. wa_find_negocios
-- ─────────────────────────────────────────────────────────────────────────────

-- SECURITY INVOKER a propósito: la llama solo service_role (que ya ve todo), y si algún día alguien le concede
-- EXECUTE a `authenticated`, el RLS de negocios/empresas/contactos sigue aplicando en vez de abrir otros workspaces.
create or replace function public.wa_find_negocios(
  p_workspace_id uuid,
  p_hint         text,
  p_limit        integer default 5
)
returns table (
  id              uuid,
  codigo          text,
  nombre          text,
  estado          text,
  empresa_id      uuid,
  empresa_nombre  text,
  contacto_id     uuid,
  contacto_nombre text,
  precio_estimado numeric,
  precio_aprobado numeric,
  stage_actual    text,
  updated_at      timestamptz,
  coincidencia    text,
  puntaje         real
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with entrada as (
    select
      upper(btrim(coalesce(p_hint, ''))) as crudo,
      regexp_replace(upper(coalesce(p_hint, '')), '[^A-Z0-9]', '', 'g') as llave,
      btrim(regexp_replace(regexp_replace(lower(unaccent(coalesce(p_hint, ''))), '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')) as txt
  ),
  palabras as (
    -- Las palabras que identifican: dos letras o más, sin conectores ni las que nombran el destino.
    select array_agg(w) as ws
    from entrada, unnest(string_to_array(entrada.txt, ' ')) as w
    where length(w) >= 2
      and w not in ('al', 'el', 'la', 'las', 'los', 'lo', 'de', 'del', 'en', 'para', 'por', 'con', 'un', 'una', 'es',
                    'ese', 'esa', 'este', 'esta', 'va', 'proyecto', 'negocio', 'cliente', 'empresa', 'obra')
  ),
  base as (
    select
      n.id, n.codigo, n.nombre, n.estado, n.empresa_id, e.nombre as empresa_nombre, n.contacto_id,
      c.nombre as contacto_nombre, n.precio_estimado, n.precio_aprobado, n.stage_actual::text as stage_actual,
      n.updated_at,
      btrim(regexp_replace(regexp_replace(lower(unaccent(coalesce(n.nombre, ''))), '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')) as nom,
      btrim(regexp_replace(regexp_replace(lower(unaccent(coalesce(e.nombre, ''))), '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')) as emp,
      btrim(regexp_replace(regexp_replace(lower(unaccent(coalesce(c.nombre, ''))), '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')) as con
    from negocios n
    left join empresas e on e.id = n.empresa_id
    left join contactos c on c.id = n.contacto_id
    where n.workspace_id = p_workspace_id
      and n.estado in ('abierto', 'activo')
  ),
  por_codigo as (
    -- Un código de negocio siempre trae dígitos («I1 26 5», «P 26 1»): sin dígitos no se intenta.
    select b.*, 'codigo'::text as coincidencia, 1::real as puntaje
    from base b, entrada x
    where x.llave ~ '[0-9]'
      and b.codigo is not null
      and regexp_replace(upper(b.codigo), '[^A-Z0-9]', '', 'g') = x.llave
    order by (upper(b.codigo) = x.crudo) desc, b.updated_at desc nulls last
    limit 1
  ),
  por_texto as (
    select b.*,
           coalesce((select bool_and(position(' ' || w || ' ' in ' ' || b.nom || ' ' || b.emp || ' ' || b.con || ' ') > 0)
                     from unnest(p.ws) as w), false) as todas,
           greatest(
             similarity(b.nom, x.txt), similarity(b.emp, x.txt), similarity(b.con, x.txt),
             word_similarity(x.txt, b.nom), word_similarity(x.txt, b.emp), word_similarity(x.txt, b.con)
           ) as sim
    from base b, entrada x, palabras p
    where x.txt <> '' and p.ws is not null
  )
  select id, codigo, nombre, estado, empresa_id, empresa_nombre, contacto_id, contacto_nombre, precio_estimado,
         precio_aprobado, stage_actual, updated_at, coincidencia, puntaje
  from por_codigo
  union all
  select * from (
    select t.id, t.codigo, t.nombre, t.estado, t.empresa_id, t.empresa_nombre, t.contacto_id, t.contacto_nombre,
           t.precio_estimado, t.precio_aprobado, t.stage_actual, t.updated_at,
           case when t.todas then 'exacta' else 'parecida' end as coincidencia,
           (case when t.todas then 1 else t.sim end)::real as puntaje
    from por_texto t
    where not exists (select 1 from por_codigo)
      and (t.todas or t.sim >= 0.5)
    order by t.todas desc, t.sim desc, t.updated_at desc nulls last
    limit greatest(coalesce(p_limit, 5), 1)
  ) as texto;
$$;

comment on function public.wa_find_negocios(uuid, text, integer) is
  'Negocios abiertos del workspace para el bot de WhatsApp: por codigo normalizado (I1 26 5 = i1-26-5 = I1265, a lo sumo uno) o por nombre del negocio, la empresa o el contacto (todas las palabras = exacta; trigramas = parecida). Solo lectura.';

-- La llama solo el bot (edge function con service_role). Nace ejecutable por PUBLIC (y por ahí por `anon`).
revoke execute on function public.wa_find_negocios(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.wa_find_negocios(uuid, text, integer) to service_role;
