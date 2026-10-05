-- ============================================================================
-- Avanzar un cruce de la línea con motivo (genérico, todos los workspaces)
-- 2026-10-05 · Brief: proyectos/soena/ve/2026-10-05_brief-max-avanzar-cruces-con-motivo.md
--
-- Los cruces de línea (`lineas_negocio.config_extra.cruces`) frenan el avance cuando
-- dos datos del negocio se contradicen, y la única salida era corregir el dato (o el
-- override de owner/admin, que se salta TODOS los gates de la etapa). Desde ahora una
-- persona autorizada (`workspaces.config_extra.avanzar_cruces.staff_ids`) puede avanzar
-- UN cruce con motivo escrito. Código: `src/lib/negocios/cruces-avance.ts`.
--
-- ── Qué crea ─────────────────────────────────────────────────────────────────
-- (1) `negocio_cruces_avanzados`: una fila por excepción. Vale para ese cruce, en ese
--     negocio, con esos datos (`huella` = hash de los valores que se contradicen). Si el
--     dato cambia y el cruce vuelve a fallar con otros valores, la huella cambia y el
--     cruce vuelve a frenar.
--     ⚠️ Solo la escribe el servidor (service_role) después de validar el permiso: la
--     sesión solo LEE. Si la sesión pudiera insertar, cualquiera se fabricaría su propia
--     excepción por PostgREST. Por eso no hay grant de insert/update/delete ni policy de
--     escritura.
-- (2) `v_cruces_avanzados_7d`: los avances de los últimos 7 días por cruce (cuántos,
--     en cuántos negocios, quién y con qué motivos), para ajustar los cruces que se
--     saltan siempre. Corre como quien la consulta (security_invoker): cada workspace ve
--     solo lo suyo.
--
-- No toca ninguna fila existente. Inerte hasta que un workspace declare la lista
-- `avanzar_cruces.staff_ids`: sin ella nadie ve el botón y el servidor rechaza a todos.
-- Con el código viejo la tabla queda vacía y nadie la lee.
-- ============================================================================

create table if not exists public.negocio_cruces_avanzados (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  negocio_id   uuid not null references public.negocios(id) on delete cascade,
  cruce_slug   text not null check (char_length(cruce_slug) between 1 and 120),
  -- Hash de los valores que se contradicen (no los valores: no se copian datos del
  -- cliente a otra tabla). Lo calcula `hashHuella` en `datos-clave-servidor.ts`.
  huella       text not null check (char_length(huella) between 1 and 128),
  -- El texto del cruce tal como se vio al avanzar (con los datos de ese momento).
  mensaje      text not null,
  motivo       text not null check (char_length(btrim(motivo)) between 15 and 280),
  etapa_id     uuid references public.etapas_negocio(id) on delete set null,
  autor_id     uuid not null,
  created_at   timestamptz not null default now(),
  constraint negocio_cruces_avanzados_autor_id_fkey foreign key (autor_id) references public.staff(id)
);

comment on table public.negocio_cruces_avanzados is
  'Excepciones de cruces de línea avanzados con motivo. Solo escribe service_role '
  '(avanzarCrucesConMotivo valida el permiso avanzar_cruces.staff_ids). Ver '
  'src/lib/negocios/cruces-avance.ts.';

create index if not exists negocio_cruces_avanzados_negocio_idx
  on public.negocio_cruces_avanzados (negocio_id, cruce_slug);
create index if not exists negocio_cruces_avanzados_ws_fecha_idx
  on public.negocio_cruces_avanzados (workspace_id, created_at desc);

alter table public.negocio_cruces_avanzados enable row level security;
revoke all on public.negocio_cruces_avanzados from anon, authenticated;
-- La ficha (tarjeta de datos clave) y el gate de avance la leen con la sesión.
grant select on public.negocio_cruces_avanzados to authenticated;
grant all on public.negocio_cruces_avanzados to service_role;

drop policy if exists negocio_cruces_avanzados_lectura on public.negocio_cruces_avanzados;
create policy negocio_cruces_avanzados_lectura on public.negocio_cruces_avanzados
  for select to authenticated
  using (workspace_id = (select public.current_user_workspace_id()));

-- ── Resumen de los últimos 7 días por cruce ──────────────────────────────────
create or replace view public.v_cruces_avanzados_7d with (security_invoker = on) as
select
  a.workspace_id,
  a.cruce_slug,
  count(*)::int                                   as avances,
  count(distinct a.negocio_id)::int               as negocios,
  string_agg(distinct s.full_name, ', ')          as autores,
  jsonb_agg(jsonb_build_object(
    'negocio', n.codigo,
    'autor', s.full_name,
    'motivo', a.motivo,
    'fecha', a.created_at
  ) order by a.created_at desc)                   as detalle,
  max(a.created_at)                               as ultimo
from public.negocio_cruces_avanzados a
join public.negocios n on n.id = a.negocio_id
left join public.staff s on s.id = a.autor_id
where a.created_at >= now() - interval '7 days'
group by a.workspace_id, a.cruce_slug;

alter view public.v_cruces_avanzados_7d set (security_invoker = on);
revoke all on public.v_cruces_avanzados_7d from anon, authenticated;
grant select on public.v_cruces_avanzados_7d to authenticated;

comment on view public.v_cruces_avanzados_7d is
  'Avances con motivo de cruces de línea en los últimos 7 días, por cruce. '
  'security_invoker: cada workspace ve solo lo suyo.';
