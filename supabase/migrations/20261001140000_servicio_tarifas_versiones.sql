-- ============================================================
-- Tarifas fijas por plan y ruta de un servicio, versionadas
-- ============================================================
--
-- Antes la propuesta económica tenía UN precio (`servicios.precio_estandar` × IVA) y el
-- comercial armaba cada plan tecleando un % de descuento por negocio. Ahora el servicio
-- puede declarar tarifas: el valor fijo de cada plan, el % que se cobra según la ruta del
-- negocio y las casillas plan × ruta que no se ofrecen. Se editan en Configuración (Mi
-- negocio → Mis servicios) y la propuesta toma el valor sola. Ver
-- `src/lib/propuesta/tarifas.ts`.
--
-- ## Por qué una tabla nueva y no `catalogo_servicios_versiones`
--
-- `catalogo_servicios_versiones` es el catálogo de lo que MéTRIK le vende a sus clientes:
-- server-only, sin `workspace_id`, firmado desde el cerebro y apuntado por
-- `servicios_contratados`. Las tarifas de aquí son de un servicio de UN workspace
-- (`servicios`) y las edita el propio cliente. Mezclarlas obligaría a abrirle a un
-- workspace una tabla que hoy no puede leer nadie con la anon key.
--
-- ## Lo que la base hace cumplir
--
--   - **Una versión no se edita ni se borra.** Un trigger rechaza UPDATE y DELETE. Cambiar
--     una tarifa es guardar una versión nueva; la anterior sigue consultable, con quién la
--     guardó y cuándo.
--   - **Vigencia por día.** `vigente_desde` (fecha de Bogotá) dice desde qué día de
--     CREACIÓN de negocio rige. Que no se pueda poner una fecha pasada lo cuida la
--     aplicación (`validarTarifaNueva`), no la base: la carga inicial de SOENA nace el
--     mismo día de su vigencia.
--   - **Escribe solo el servidor.** Sin grant de escritura para `authenticated`: la
--     acción revisa el rol (dueño o administrador) y escribe con service_role. Leer sí
--     puede cualquiera del workspace: la propuesta de cada negocio la necesita.
--
-- Solo DDL: ninguna fila se escribe. La tarifa de SOENA va en la migración siguiente.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select relrowsecurity from pg_class where oid = 'public.servicio_tarifas_versiones'::regclass;
--     -> true
--   select has_table_privilege('authenticated','public.servicio_tarifas_versiones','insert');
--     -> false
--   select count(*) from public.servicio_tarifas_versiones;  -> 0
-- ============================================================

create table public.servicio_tarifas_versiones (
  id uuid primary key default gen_random_uuid(),
  -- Sin cascade: el historial no se borra, así que un servicio con tarifas no se elimina
  -- (se desactiva). Un cascade chocaría además con el trigger de inmutabilidad.
  workspace_id uuid not null references public.workspaces(id),
  servicio_id uuid not null references public.servicios(id),
  version integer not null check (version > 0),
  vigente_desde date not null,
  -- [{ "n": 1, "nombre": "Plan 1", "valor": 910000 }, ...] — valores con IVA.
  planes jsonb not null
    constraint servicio_tarifas_planes_lista check (jsonb_typeof(planes) = 'array' and jsonb_array_length(planes) > 0),
  -- [{ "valor": "solo_upme", "nombre": "Solo UPME", "pct": 50 }, ...]
  rutas jsonb not null
    constraint servicio_tarifas_rutas_lista check (jsonb_typeof(rutas) = 'array' and jsonb_array_length(rutas) > 0),
  -- [{ "plan": 1, "ruta": "solo_iva" }, ...] — casillas que no se ofrecen.
  no_ofrece jsonb not null default '[]'::jsonb
    constraint servicio_tarifas_no_ofrece_lista check (jsonb_typeof(no_ofrece) = 'array'),
  cap_descuento_pct numeric(5,2) not null
    constraint servicio_tarifas_cap_rango check (cap_descuento_pct >= 0 and cap_descuento_pct <= 100),
  -- Staff que la guardó. Null en la carga inicial por migración.
  creado_por uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  nota text constraint servicio_tarifas_nota_corta check (nota is null or length(nota) <= 280),
  constraint servicio_tarifas_version_unica unique (servicio_id, version)
);

create index idx_servicio_tarifas_vigencia
  on public.servicio_tarifas_versiones (servicio_id, vigente_desde desc, version desc);
create index idx_servicio_tarifas_workspace
  on public.servicio_tarifas_versiones (workspace_id);

create or replace function public.servicio_tarifas_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'servicio_tarifas_versiones: una versión de tarifas no se modifica ni se borra (% no permitido). Guarda una versión nueva.', tg_op;
end;
$$;

create trigger trg_servicio_tarifas_inmutable
  before update or delete on public.servicio_tarifas_versiones
  for each row execute function public.servicio_tarifas_inmutable();

-- PostgreSQL no exige EXECUTE para DISPARAR un trigger: el revoke no la apaga.
revoke execute on function public.servicio_tarifas_inmutable() from public, anon, authenticated;

alter table public.servicio_tarifas_versiones enable row level security;

create policy servicio_tarifas_lectura on public.servicio_tarifas_versiones
  for select using (workspace_id = (select public.current_user_workspace_id()));

revoke all on table public.servicio_tarifas_versiones from public, anon, authenticated;
grant select on public.servicio_tarifas_versiones to authenticated;
