-- ============================================================
-- El DDL de `public` en producción, para correr el clonador del espacio de pruebas contra un
-- Postgres de verdad (PGlite) con el esquema real:
--
--   ESPACIO_PRUEBAS_ESQUEMA=/ruta/esquema.sql npx vitest run src/lib/espacio-pruebas/ensayo-postgres.test.ts
--
-- SOLO LECTURA del catálogo: no lee filas de ninguna tabla. Devuelve una fila por objeto
-- (`orden`, `nombre`, `ddl`); el archivo es la concatenación de `ddl` en ese orden. Si el
-- resultado es grande, paginar con `where orden = N` (cada sección por separado).
--
-- Qué trae: tipos enum, secuencias, funciones de `public` que usan los defaults y los triggers,
-- tablas (columnas, tipos, defaults, GENERATED, NOT NULL), PK/UNIQUE/CHECK, índices únicos
-- sueltos, llaves foráneas (al final, para que el orden de las tablas no importe) y triggers.
-- No trae RLS ni grants: el clonador escribe con la llave de servicio.
-- ============================================================

with
tablas as (
  select c.oid, c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
),
propias as (
  select p.oid, p.proname, p.prosrc
  from pg_proc p join pg_namespace pn on pn.oid = p.pronamespace
  where pn.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') -- no las de extensiones
),
semillas as (
  -- Las que llaman los triggers de las tablas de public…
  select t.tgfoid as oid from pg_trigger t join tablas on tablas.oid = t.tgrelid where not t.tgisinternal
  -- …las que aparecen en un default o una expresión generada…
  union
  select p.oid from pg_attrdef d join tablas on tablas.oid = d.adrelid
  join propias p on pg_get_expr(d.adbin, d.adrelid) ~ ('\m' || p.proname || '\(')
  -- …y en un CHECK o un índice.
  union
  select p.oid from pg_constraint co join tablas on tablas.oid = co.conrelid
  join propias p on pg_get_constraintdef(co.oid) ~ ('\m' || p.proname || '\(')
  union
  select p.oid from pg_index i join tablas on tablas.oid = i.indrelid
  join propias p on pg_get_indexdef(i.indexrelid) ~ ('\m' || p.proname || '\(')
),
funciones_usadas (oid) as (
  -- Y, de ahí, las que esas llaman por nombre en su cuerpo (helpers), hasta cerrar.
  with recursive cierre (oid) as (
    select oid from semillas
    union
    select q.oid from cierre c join propias f on f.oid = c.oid join propias q on f.prosrc ~ ('\m' || q.proname || '\(')
  )
  select oid from cierre
)
select orden, nombre, ddl from (
  -- 0. Cabecera
  select 0 as orden, '' as nombre, 'set check_function_bodies = off;' as ddl

  -- 1. Tipos enum
  union all
  select 1, t.typname,
    format('create type public.%I as enum (%s);', t.typname,
      (select string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid))
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typtype = 'e'

  -- 2. Secuencias
  union all
  select 2, c.relname, format('create sequence if not exists public.%I;', c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S'

  -- 3. Funciones que usan los defaults y los triggers
  union all
  select 3, p.proname, pg_get_functiondef(p.oid) || ';'
  from pg_proc p where p.oid in (select oid from funciones_usadas) and p.prokind = 'f'

  -- 4. Tablas
  union all
  select 4, tablas.relname,
    format('create table public.%I (%s);', tablas.relname, string_agg(
      format('%I %s%s%s', a.attname, format_type(a.atttypid, a.atttypmod),
        case
          when a.attgenerated = 's' then format(' generated always as (%s) stored', pg_get_expr(d.adbin, d.adrelid))
          when a.attidentity in ('a', 'd') then format(' generated %s as identity', case a.attidentity when 'a' then 'always' else 'by default' end)
          when d.adbin is not null then ' default ' || pg_get_expr(d.adbin, d.adrelid)
          else ''
        end,
        case when a.attnotnull then ' not null' else '' end),
      ', ' order by a.attnum))
  from tablas
  join pg_attribute a on a.attrelid = tablas.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  group by tablas.relname

  -- 5. PK, UNIQUE y CHECK
  union all
  select 5, tablas.relname || '.' || co.conname,
    format('alter table public.%I add constraint %I %s;', tablas.relname, co.conname, pg_get_constraintdef(co.oid))
  from pg_constraint co join tablas on tablas.oid = co.conrelid
  where co.contype in ('p', 'u', 'c', 'x')

  -- 6. Índices únicos que no respaldan una restricción (p. ej. parciales, que usa un ON CONFLICT)
  union all
  select 6, ic.relname, pg_get_indexdef(i.indexrelid) || ';'
  from pg_index i
  join tablas on tablas.oid = i.indrelid
  join pg_class ic on ic.oid = i.indexrelid
  where i.indisunique and not exists (select 1 from pg_constraint co where co.conindid = i.indexrelid)

  -- 7. Llaves foráneas
  union all
  select 7, tablas.relname || '.' || co.conname,
    format('alter table public.%I add constraint %I %s;', tablas.relname, co.conname, pg_get_constraintdef(co.oid))
  from pg_constraint co join tablas on tablas.oid = co.conrelid
  where co.contype = 'f'

  -- 8. Triggers
  union all
  select 8, tablas.relname || '.' || t.tgname, pg_get_triggerdef(t.oid) || ';'
  from pg_trigger t join tablas on tablas.oid = t.tgrelid
  where not t.tgisinternal
) x
order by orden, nombre;
